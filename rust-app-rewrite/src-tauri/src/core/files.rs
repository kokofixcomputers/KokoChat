//! Reading and changing files, with the same safety rules and messages as the Electron version.
use super::{flag, num, shell, text, Res, ToolError};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

const MAX_READ_BYTES: u64 = 2_000_000;

pub fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// Like Node's path.resolve: joins and removes "." and ".." without touching the disk.
pub fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub struct Resolved {
    pub abs: PathBuf,
    pub rel: String,
}

/// Resolve `p` against the project folder; refuses anything that ends up outside it (symlinks included) unless allow_outside.
pub fn resolve_in(cwd: &str, p: &str, allow_outside: bool) -> Result<Resolved, ToolError> {
    if cwd.is_empty() {
        return Err(ToolError::new("NO_CWD", "No project folder is open."));
    }
    let root = normalize(&std::env::current_dir().unwrap_or_default().join(cwd));
    let p = if p.is_empty() { "." } else { p };
    let expanded = if p == "~" {
        home()
    } else if let Some(rest) = p.strip_prefix("~/") {
        home().join(rest)
    } else {
        PathBuf::from(p)
    };
    let abs = normalize(&root.join(expanded));
    // follow links; for a path that does not exist yet, check the nearest existing parent
    let real = fs::canonicalize(&abs).unwrap_or_else(|_| {
        let mut dir = abs.parent().map(Path::to_path_buf).unwrap_or_default();
        while !dir.exists() && dir.pop() {}
        match (fs::canonicalize(&dir), abs.strip_prefix(&dir)) {
            (Ok(d), Ok(rest)) => d.join(rest),
            _ => abs.clone(),
        }
    });
    let real_root = fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    let inside = real.starts_with(&real_root);
    if !inside && !allow_outside {
        return Err(ToolError::new("OUTSIDE", format!("{} is outside the project folder.", abs.display())));
    }
    let rel = if inside {
        match abs.strip_prefix(&root) {
            Ok(r) if r.as_os_str().is_empty() => ".".into(),
            Ok(r) => r.to_string_lossy().into_owned(),
            Err(_) => abs.to_string_lossy().into_owned(),
        }
    } else {
        abs.to_string_lossy().into_owned()
    };
    Ok(Resolved { abs, rel })
}

pub fn resolve_args(a: &Value) -> Result<Resolved, ToolError> {
    resolve_in(text(a, "cwd"), text(a, "path"), flag(a, "allowOutside"))
}

pub fn is_binary(buf: &[u8]) -> bool {
    buf.iter().take(4000).any(|&b| b == 0)
}

fn clip(line: &str, max: usize) -> String {
    match line.char_indices().nth(max) {
        Some((i, _)) => format!("{}…", &line[..i]),
        None => line.to_string(),
    }
}

fn read_text(abs: &Path) -> std::io::Result<String> {
    fs::read(abs).map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// Text of a file we are about to change. Refuses files that are not UTF-8, so a change can never silently damage other bytes.
fn read_for_change(abs: &Path, rel: &str) -> Result<String, ToolError> {
    let bytes = fs::read(abs).map_err(|_| ToolError::new("ENOENT", format!("No such file: {rel}. Use write_file to create it.")))?;
    String::from_utf8(bytes).map_err(|_| ToolError::new("BINARY", format!("{rel} is not a UTF-8 text file, so it was left unchanged.")))
}

pub fn read(a: &Value) -> Res {
    let Resolved { abs, rel } = resolve_args(a)?;
    let st = fs::metadata(&abs).map_err(|_| ToolError::new("ENOENT", format!("No such file: {rel}")))?;
    if st.is_dir() {
        return Err(ToolError::new("EISDIR", format!("{rel} is a folder. Use list_files.")));
    }
    if st.len() > MAX_READ_BYTES {
        return Err(ToolError::new("TOOBIG", format!("{rel} is {:.1} MB, too large to read. Use search_code or read part of it with run_command.", st.len() as f64 / 1e6)));
    }
    let buf = fs::read(&abs)?;
    if is_binary(&buf) {
        return Err(ToolError::new("BINARY", format!("{rel} looks like a binary file.")));
    }
    let all = String::from_utf8_lossy(&buf);
    let lines: Vec<&str> = all.split('\n').collect();
    let start = num(a, "offset").unwrap_or(1.0).floor().max(1.0) as usize;
    let limit = num(a, "limit").unwrap_or(2000.0).floor().max(1.0) as usize;
    let slice: &[&str] = if start <= lines.len() { &lines[start - 1..lines.len().min(start - 1 + limit)] } else { &[] };
    let width = (start + slice.len()).to_string().len();
    let body: Vec<String> = slice.iter().enumerate().map(|(i, l)| format!("{:>width$}\t{}", start + i, clip(l, 2000))).collect();
    Ok(json!({ "path": rel, "totalLines": lines.len(), "from": start, "to": (start + slice.len()) as i64 - 1, "text": body.join("\n"), "truncated": start - 1 + slice.len() < lines.len() }))
}

/// Small line diff (common head and tail trimmed) with a few lines of context, for display.
pub fn make_diff(old: &str, new: &str) -> Value {
    let a: Vec<&str> = old.split('\n').collect();
    let b: Vec<&str> = new.split('\n').collect();
    let mut s = 0;
    while s < a.len() && s < b.len() && a[s] == b[s] {
        s += 1;
    }
    let (mut ea, mut eb) = (a.len(), b.len());
    while ea > s && eb > s && a[ea - 1] == b[eb - 1] {
        ea -= 1;
        eb -= 1;
    }
    let line = |t: &str, n: usize, v: &str| json!({ "t": t, "n": n, "s": v });
    let mut lines = Vec::new();
    for i in s.saturating_sub(3)..s {
        lines.push(line(" ", i + 1, a[i]));
    }
    for i in s..ea {
        lines.push(line("-", i + 1, a[i]));
    }
    for i in s..eb {
        lines.push(line("+", i + 1, b[i]));
    }
    for i in ea..a.len().min(ea + 3) {
        lines.push(line(" ", i - ea + eb + 1, a[i]));
    }
    let truncated = lines.len() > 400;
    lines.truncate(400);
    json!({ "added": eb - s, "removed": ea - s, "lines": lines, "truncated": truncated, "firstLine": s + 1 })
}

fn numbered(t: &str, from: i64, to: i64) -> String {
    let lines: Vec<&str> = t.split('\n').collect();
    let a = from.max(1) as usize;
    let b = (to.max(0) as usize).min(lines.len());
    if a > b {
        return String::new();
    }
    lines[a - 1..b].iter().enumerate().map(|(i, l)| format!("{}\t{}", a + i, clip(l, 200))).collect::<Vec<_>>().join("\n")
}
fn preview_head(t: &str) -> String {
    let n = t.split('\n').count();
    let more = if n > 30 { format!("\n…({} more lines; read_file to see them)", n - 30) } else { String::new() };
    numbered(t, 1, 30) + &more
}
fn preview_around(t: &str, added_from: i64) -> String {
    let n = t.split('\n').count() as i64;
    let more = if n > added_from + 22 { format!("\n…({} more lines)", n - added_from - 22) } else { String::new() };
    numbered(t, added_from - 3, added_from + 22) + &more
}

/// A quick real check of what was written. Empty when fine or not checkable. JavaScript needs `node` on your PATH
/// (the Electron app used the Node inside itself); without it that check is skipped.
fn syntax_check(abs: &Path, content: &str) -> String {
    let ext = abs.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let file = abs.to_string_lossy().into_owned();
    let (cmd, args): (&str, Vec<&str>) = match ext.as_str() {
        "json" => return serde_json::from_str::<serde::de::IgnoredAny>(content).err().map(|e| e.to_string()).unwrap_or_default(),
        "js" | "cjs" | "mjs" => ("node", vec!["--check", &file]),
        "py" => (if cfg!(windows) { "python" } else { "python3" }, vec!["-m", "py_compile", &file]),
        "sh" if cfg!(unix) => ("bash", vec!["-n", &file]),
        _ => return String::new(),
    };
    let Some(out) = shell::quick(cmd, &args, None, 6000) else { return String::new() };
    if out.ok {
        return String::new();
    }
    let short = abs.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let msg: Vec<String> = out
        .stderr
        .lines()
        .filter(|l| !l.trim().is_empty() && !(l.starts_with(char::is_whitespace) && l.trim_start().starts_with("at ")) && !l.starts_with("Node.js v"))
        .map(|l| match l.rfind(&format!("/{short}:")) {
            Some(i) if l.starts_with('/') => l[i + 1..].to_string(),
            _ => l.to_string(),
        })
        .collect();
    let msg = msg.join("\n");
    let esm = ["Cannot use import statement", "Unexpected token 'export'", "Cannot use 'import.meta'", "await is only valid"];
    if esm.iter().any(|m| msg.contains(m)) {
        return String::new();
    }
    msg.chars().take(500).collect()
}

/// Share of the old file's meaningful lines that are gone from the new text: (total, lost).
fn lost_lines(old: &str, new: &str) -> (usize, usize) {
    let keep: HashSet<&str> = new.split('\n').map(str::trim).filter(|l| !l.is_empty()).collect();
    let lines: Vec<&str> = old.split('\n').map(str::trim).filter(|l| l.chars().count() > 1).collect();
    (lines.len(), lines.iter().filter(|l| !keep.contains(*l)).count())
}

fn count_lines(t: &str) -> usize {
    t.split('\n').count()
}

pub fn write(a: &Value) -> Res {
    let Resolved { abs, rel } = resolve_args(a)?;
    let old = match fs::metadata(&abs) {
        Ok(st) if st.is_dir() => return Err(ToolError::new("EISDIR", format!("{rel} is a folder."))),
        Ok(_) => Some(read_text(&abs)?),
        Err(_) => None,
    };
    let content = text(a, "content");
    if let (true, Some(o), false) = (flag(a, "guard"), old.as_deref(), flag(a, "overwrite")) {
        let (total, lost) = lost_lines(o, content);
        if total >= 8 && lost as f64 / total as f64 > 0.35 {
            return Err(ToolError::new("CLOBBER", format!("Refused: {rel} already has {} lines and this write would delete {lost} of its {total} lines. Nothing was changed. To ADD something, use append_file (adds to the end) or edit_file (insert next to existing text). To change one part, use edit_file. Only if you really mean to replace the whole file, read it first and call write_file again with overwrite set to true.", count_lines(o))));
        }
    }
    if old.as_deref() == Some(content) {
        return Ok(json!({ "path": rel, "created": false, "unchanged": true, "bytes": content.len(), "diff": make_diff(content, content) }));
    }
    if let Some(dir) = abs.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(&abs, content)?;
    Ok(json!({ "path": rel, "created": old.is_none(), "bytes": content.len(), "diff": make_diff(old.as_deref().unwrap_or(""), content), "totalLines": count_lines(content), "preview": preview_head(content), "syntax": syntax_check(&abs, content) }))
}

pub fn append(a: &Value) -> Res {
    let Resolved { abs, rel } = resolve_args(a)?;
    let old = read_for_change(&abs, &rel)?;
    let add = text(a, "content");
    if add.is_empty() {
        return Err(ToolError::new("EMPTY", "content is empty."));
    }
    if add.trim().chars().count() >= 12 && old.contains(add.trim()) {
        return Ok(json!({ "path": rel, "unchanged": true, "diff": make_diff(&old, &old), "bytes": old.len(), "totalLines": count_lines(&old) }));
    }
    let nl = |t: &str| if t.is_empty() || t.ends_with('\n') { t.to_string() } else { format!("{t}\n") };
    let at_start = text(a, "position") == "start";
    let next = if at_start { nl(add) + &old } else { nl(&old) + &nl(add) };
    fs::write(&abs, &next)?;
    let added_from = if at_start { 1 } else { count_lines(&old) as i64 - i64::from(old.ends_with('\n')) + 1 };
    Ok(json!({ "path": rel, "diff": make_diff(&old, &next), "bytes": next.len(), "totalLines": count_lines(&next), "preview": preview_around(&next, added_from), "syntax": syntax_check(&abs, &next) }))
}

/* Finding the text to replace. The AI copies from read_file output, which has line numbers in front, and it often loses tabs, trailing
   spaces, Windows line endings or indentation on the way. Try the exact text first, then forgive those slips one at a time. */

/// "  12\tfoo" -> "foo" (also "12  foo" and "12 | foo")
fn without_number(line: &str) -> Option<&str> {
    let t = line.trim_start();
    let digits = t.len() - t.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    if digits == 0 {
        return None;
    }
    let rest = &t[digits..];
    if let Some(r) = rest.strip_prefix('\t') {
        return Some(r);
    }
    let r = rest.strip_prefix(' ')?;
    let r = r.strip_prefix(' ').unwrap_or(r);
    let r = r.strip_prefix('|').unwrap_or(r);
    Some(r.strip_prefix(' ').unwrap_or(r))
}
fn strip_nums(t: &str) -> String {
    let full: Vec<&str> = t.split('\n').filter(|l| !l.trim().is_empty()).collect();
    if full.is_empty() || !full.iter().all(|l| without_number(l).is_some()) {
        return t.to_string();
    }
    t.split('\n').map(|l| without_number(l).unwrap_or(l)).collect::<Vec<_>>().join("\n")
}
fn indent_of(l: &str) -> &str {
    &l[..l.len() - l.trim_start_matches([' ', '\t']).len()]
}
fn squash(l: &str) -> String {
    l.split_whitespace().collect::<Vec<_>>().join(" ")
}
fn no_cr(l: &str) -> &str {
    l.strip_suffix('\r').unwrap_or(l)
}

enum Match {
    Exact { find: String, repl: String, count: usize, how: &'static str },
    Fuzzy { hits: Vec<usize>, want: Vec<String>, lines: Vec<String>, eol: &'static str },
}

fn locate(old: &str, find: &str, repl: &str) -> Option<Match> {
    let crlf = old.contains("\r\n");
    let norm = |t: &str| {
        let lf = t.replace("\r\n", "\n");
        if crlf { lf.replace('\n', "\r\n") } else { lf }
    };
    let mut tries: Vec<(String, String, &'static str)> = vec![(find.into(), repl.into(), "")];
    let nf = strip_nums(find);
    if nf != find {
        tries.push((nf.clone(), strip_nums(repl), "ignoring the line numbers copied from read_file"));
    }
    for i in 0..tries.len() {
        let f = norm(&tries[i].0);
        if f != tries[i].0 {
            tries.push((f, norm(&tries[i].1), "ignoring a line-ending difference"));
        }
    }
    for (f, r, how) in tries {
        let count = old.matches(f.as_str()).count();
        if count > 0 {
            return Some(Match::Exact { find: f, repl: r, count, how });
        }
    }
    let lines: Vec<String> = old.split('\n').map(|l| no_cr(l).to_string()).collect();
    let mut want: Vec<String> = nf.split('\n').map(|l| no_cr(l).to_string()).collect();
    while want.last().is_some_and(|l| l.trim().is_empty()) {
        want.pop();
    }
    while want.first().is_some_and(|l| l.trim().is_empty()) {
        want.remove(0);
    }
    if want.is_empty() {
        return None;
    }
    let keys: Vec<String> = want.iter().map(|l| squash(l)).collect();
    let mut hits = Vec::new();
    let mut i = 0;
    while i + want.len() <= lines.len() {
        if (0..want.len()).all(|j| squash(&lines[i + j]) == keys[j]) {
            hits.push(i);
            i += want.len();
        } else {
            i += 1;
        }
    }
    if hits.is_empty() {
        return None;
    }
    Some(Match::Fuzzy { hits, want, lines, eol: if crlf { "\r\n" } else { "\n" } })
}

/// The part of the file that looks most like what the AI asked for, with line numbers so it can copy it exactly.
fn nearest(old: &str, find: &str) -> String {
    let lines: Vec<&str> = old.split('\n').collect();
    let stripped = strip_nums(find);
    let mut probes: Vec<&str> = stripped.split('\n').map(str::trim).filter(|l| l.chars().count() > 3).collect();
    probes.sort_by_key(|p| std::cmp::Reverse(p.chars().count()));
    for probe in probes.into_iter().take(4) {
        let k = squash(probe);
        if let Some(i) = lines.iter().position(|l| {
            let x = squash(l);
            x.contains(&k) || (x.chars().count() >= 6 && k.contains(&x))
        }) {
            return format!("The closest match in the file is around line {}. This is what is actually there (copy from it, keep its exact spacing):\n{}", i + 1, numbered(old, i as i64, i as i64 + 13));
        }
    }
    format!("None of the lines of your old_string were found anywhere in the file (it has {} lines). The file may have changed since you read it: call read_file again, then copy a short, unique piece from the result.", lines.len())
}

pub fn edit(a: &Value) -> Res {
    let Resolved { abs, rel } = resolve_args(a)?;
    let old = read_for_change(&abs, &rel)?;
    let (find, repl) = (text(a, "oldString"), text(a, "newString"));
    let all = flag(a, "replaceAll");
    if find.is_empty() {
        return Err(ToolError::new("EMPTY", "old_string is empty. To create or overwrite a file use write_file."));
    }
    if find == repl {
        return Err(ToolError::new("SAME", "old_string and new_string are identical."));
    }
    let Some(m) = locate(&old, find, repl) else {
        return Err(ToolError::new("NOTFOUND", format!("old_string was not found in {rel}. {}", nearest(&old, find))));
    };
    let count = match &m {
        Match::Exact { count, .. } => *count,
        Match::Fuzzy { hits, .. } => hits.len(),
    };
    if count > 1 && !all {
        return Err(ToolError::new("AMBIGUOUS", format!("old_string appears {count} times in {rel}. Add more surrounding lines to make it unique, or set replace_all.")));
    }
    let (next, how) = match m {
        Match::Exact { find, repl, how, .. } => (if all { old.replace(&find, &repl) } else { old.replacen(&find, &repl, 1) }, how),
        Match::Fuzzy { hits, want, lines, eol } => {
            let repl_lines: Vec<String> = strip_nums(repl).split('\n').map(|l| no_cr(l).to_string()).collect();
            let mut out: Vec<String> = Vec::new();
            let mut at = 0;
            for &h in hits.iter().take(if all { hits.len() } else { 1 }) {
                out.extend_from_slice(&lines[at..h]);
                // the replacement takes the file's indentation where the AI's copy had a different one
                let (file_ind, asked) = (indent_of(&lines[h]), indent_of(&want[0]));
                for l in &repl_lines {
                    out.push(if l.trim().is_empty() || asked == file_ind {
                        l.clone()
                    } else if let Some(rest) = l.strip_prefix(asked) {
                        format!("{file_ind}{rest}")
                    } else {
                        format!("{file_ind}{}", l.trim_start())
                    });
                }
                at = h + want.len();
            }
            out.extend_from_slice(&lines[at..]);
            (out.join(eol), "ignoring whitespace and indentation differences")
        }
    };
    fs::write(&abs, &next)?;
    let mut res = json!({ "path": rel, "replaced": if all { count } else { 1 }, "diff": make_diff(&old, &next), "totalLines": count_lines(&next), "syntax": syntax_check(&abs, &next) });
    if !how.is_empty() {
        res["matched"] = json!(how);
    }
    Ok(res)
}

pub fn write_base64(a: &Value) -> Res {
    let Resolved { abs, rel } = resolve_args(a)?;
    let existed = abs.exists();
    let data: String = text(a, "base64").chars().filter(|c| !c.is_whitespace()).collect();
    let buf = B64.decode(data).map_err(|e| ToolError::new("ERR", format!("Bad base64 data: {e}")))?;
    if let Some(dir) = abs.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(&abs, &buf)?;
    Ok(json!({ "path": rel, "bytes": buf.len(), "created": !existed }))
}

/// A file's contents for the viewer: text (capped), a picture, or "binary".
pub fn read_raw(a: &Value) -> Res {
    let Resolved { abs, rel } = resolve_args(a)?;
    let st = fs::metadata(&abs).map_err(|_| ToolError::new("ENOENT", format!("No such file: {rel}")))?;
    if st.is_dir() {
        return Err(ToolError::new("EISDIR", format!("{rel} is a folder.")));
    }
    let mime = match abs.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "ico" => Some("image/x-icon"),
        _ => None,
    };
    if let (Some(m), true) = (mime, st.len() <= 4_000_000) {
        return Ok(json!({ "path": rel, "size": st.len(), "image": format!("data:{m};base64,{}", B64.encode(fs::read(&abs)?)) }));
    }
    const CAP: u64 = 400_000;
    let mut buf = Vec::new();
    fs::File::open(&abs)?.take(CAP).read_to_end(&mut buf)?;
    if is_binary(&buf) {
        return Ok(json!({ "path": rel, "size": st.len(), "binary": true }));
    }
    Ok(json!({ "path": rel, "size": st.len(), "text": String::from_utf8_lossy(&buf), "truncated": st.len() > CAP }))
}
