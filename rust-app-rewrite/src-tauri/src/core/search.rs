//! Listing, finding and searching files.
use super::{files, flag, num, text, Res, ToolError};
use fancy_regex::{Regex, RegexBuilder};
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};

const IGNORED: &[&str] = &["node_modules", ".git", "dist", "build", ".next", ".nuxt", ".turbo", ".cache", "coverage", "__pycache__", ".venv", "venv", "target", ".gradle", ".idea", "out", ".svelte-kit", ".parcel-cache"];

/// Case-insensitive order where "file2" comes before "file10".
fn natural(a: &str, b: &str, numbers: bool) -> Ordering {
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return a.cmp(b),
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(c), Some(d)) if numbers && c.is_ascii_digit() && d.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut n = String::new();
                    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
                        n.push(c);
                        it.next();
                    }
                    n.trim_start_matches('0').to_string()
                };
                let (m, n) = (take(&mut x), take(&mut y));
                let o = m.len().cmp(&n.len()).then_with(|| m.cmp(&n));
                if o != Ordering::Equal {
                    return o;
                }
            }
            (Some(c), Some(d)) => {
                let o = c.to_lowercase().cmp(d.to_lowercase());
                if o != Ordering::Equal {
                    return o;
                }
                x.next();
                y.next();
            }
        }
    }
}

struct Entry {
    name: String,
    dir: bool,
}
/// Folders first. `numbers`: the file tree puts file2 before file10; the agent's listing sorts by letters only.
fn entries(dir: &Path, numbers: bool) -> std::io::Result<Vec<Entry>> {
    let mut v: Vec<Entry> = fs::read_dir(dir)?
        .flatten()
        .map(|e| Entry { name: e.file_name().to_string_lossy().into_owned(), dir: e.file_type().is_ok_and(|t| t.is_dir()) })
        .collect();
    v.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| natural(&a.name, &b.name, numbers)));
    Ok(v)
}

pub fn list(a: &Value) -> Res {
    let r = files::resolve_args(a)?;
    let depth = num(a, "depth").unwrap_or(2.0) as usize;
    match fs::metadata(&r.abs) {
        Ok(m) if !m.is_dir() => return Err(ToolError::new("ENOTDIR", format!("{} is a file.", r.rel))),
        Err(_) => return Err(ToolError::new("ENOENT", format!("No such folder: {}", r.rel))),
        _ => {}
    }
    fn walk(dir: &Path, level: usize, depth: usize, prefix: &str, lines: &mut Vec<String>, count: &mut usize) {
        let Ok(es) = entries(dir, false) else { return };
        for e in es {
            if *count >= 500 {
                lines.push(format!("{prefix}…"));
                return;
            }
            if e.name == ".DS_Store" {
                continue;
            }
            *count += 1;
            if !e.dir {
                lines.push(format!("{prefix}{}", e.name));
            } else if IGNORED.contains(&e.name.as_str()) {
                lines.push(format!("{prefix}{}/ (skipped)", e.name));
            } else {
                lines.push(format!("{prefix}{}/", e.name));
                if level < depth {
                    walk(&dir.join(&e.name), level + 1, depth, &format!("{prefix}  "), lines, count);
                }
            }
        }
    }
    let (mut lines, mut count) = (Vec::new(), 0);
    walk(&r.abs, 1, depth, "", &mut lines, &mut count);
    let out = if lines.is_empty() { "(empty)".to_string() } else { lines.join("\n") };
    Ok(json!({ "path": r.rel, "text": out, "count": count }))
}

/// One folder level, for the file tree (folders first).
pub fn tree(a: &Value) -> Res {
    let r = files::resolve_args(a)?;
    let es = entries(&r.abs, true).map_err(|_| ToolError::new("ENOENT", format!("Cannot open {}.", r.rel)))?;
    let mut out = Vec::new();
    for e in es.iter().filter(|e| e.name != ".git" && e.name != ".DS_Store") {
        if e.dir && IGNORED.contains(&e.name.as_str()) {
            out.push(json!({ "name": e.name, "type": "dir", "hidden": true }));
        } else {
            let size = if e.dir { 0 } else { fs::metadata(r.abs.join(&e.name)).map(|m| m.len()).unwrap_or(0) };
            out.push(json!({ "name": e.name, "type": if e.dir { "dir" } else { "file" }, "size": size }));
        }
    }
    let truncated = out.len() > 800;
    out.truncate(800);
    Ok(json!({ "path": r.rel, "entries": out, "truncated": truncated }))
}

/// glob -> regex: ** crosses folders, * and ? stay inside one, {a,b} alternatives.
fn glob_to_regex(glob: &str) -> Result<Regex, ToolError> {
    let c: Vec<char> = glob.chars().collect();
    let esc = |s: &str| fancy_regex::escape(s).into_owned();
    let mut re = String::from("^");
    let mut i = 0;
    while i < c.len() {
        match c[i] {
            '*' if c.get(i + 1) == Some(&'*') => {
                i += 1;
                if c.get(i + 1) == Some(&'/') {
                    i += 1;
                    re.push_str("(?:.*/)?");
                } else {
                    re.push_str(".*");
                }
            }
            '*' => re.push_str("[^/]*"),
            '?' => re.push_str("[^/]"),
            '{' => match c[i..].iter().position(|&x| x == '}') {
                Some(n) => {
                    let inner: String = c[i + 1..i + n].iter().collect();
                    re.push_str(&format!("(?:{})", inner.split(',').map(esc).collect::<Vec<_>>().join("|")));
                    i += n;
                }
                None => re.push_str("\\{"),
            },
            other => re.push_str(&esc(&other.to_string())),
        }
        i += 1;
    }
    re.push('$');
    Regex::new(&re).map_err(|e| ToolError::new("ERR", format!("Bad pattern: {e}")))
}

/// Visit every file below `root` (skipping dependency and build folders and links) until `f` returns false.
fn walk_files(root: &Path, f: &mut dyn FnMut(&Path) -> bool) {
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(es) = fs::read_dir(&dir) else { continue };
        for e in es.flatten() {
            let Ok(t) = e.file_type() else { continue };
            if t.is_dir() {
                if !IGNORED.contains(&e.file_name().to_string_lossy().as_ref()) {
                    stack.push(e.path());
                }
            } else if t.is_file() && !f(&e.path()) {
                return;
            }
        }
    }
}

fn relative(p: &Path, base: &Path) -> String {
    p.strip_prefix(base).unwrap_or(p).to_string_lossy().replace('\\', "/")
}
fn base_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

pub fn find(a: &Value) -> Res {
    let r = files::resolve_args(a)?;
    let pattern = text(a, "pattern");
    if pattern.is_empty() {
        return Err(ToolError::new("EMPTY", "Provide a glob pattern like **/*.ts"));
    }
    let re = glob_to_regex(pattern.strip_prefix("./").unwrap_or(pattern))?;
    let by_name = !pattern.contains('/');
    let mut out: Vec<String> = Vec::new();
    walk_files(&r.abs, &mut |p| {
        let rel = relative(p, &r.abs);
        let target = if by_name { base_name(p) } else { rel.clone() };
        if re.is_match(&target).unwrap_or(false) {
            out.push(rel);
        }
        out.len() < 300
    });
    out.sort();
    let truncated = out.len() >= 300;
    Ok(json!({ "path": r.rel, "files": out, "truncated": truncated }))
}

pub fn search(a: &Value) -> Res {
    let r = files::resolve_args(a)?;
    let pattern = text(a, "pattern");
    if pattern.is_empty() {
        return Err(ToolError::new("EMPTY", "Provide a search pattern."));
    }
    let ci = flag(a, "ignoreCase");
    let build = |p: &str| RegexBuilder::new(&if ci { format!("(?i){p}") } else { p.to_string() }).build();
    // not a valid pattern: search for it as plain text
    let re = build(pattern).or_else(|_| build(&fancy_regex::escape(pattern))).map_err(|e| ToolError::new("ERR", e.to_string()))?;
    let glob = text(a, "glob");
    let gre = if glob.is_empty() { None } else { Some(glob_to_regex(glob)?) };
    let by_name = !glob.is_empty() && !glob.contains('/');
    let ctx = num(a, "context").unwrap_or(0.0).clamp(0.0, 5.0) as usize;
    let max = num(a, "maxResults").unwrap_or(150.0) as usize;
    let single = fs::metadata(&r.abs).map_err(|_| ToolError::new("ENOENT", format!("No such path: {}", r.rel)))?.is_file();
    let base = if single { r.abs.parent().unwrap_or(&r.abs).to_path_buf() } else { r.abs.clone() };
    let mut results: Vec<String> = Vec::new();
    let mut count = 0;
    let mut visit = |p: &Path| -> bool {
        let rel = relative(p, &base);
        if let Some(g) = &gre {
            if !g.is_match(&if by_name { base_name(p) } else { rel.clone() }).unwrap_or(false) {
                return true;
            }
        }
        if fs::metadata(p).map(|m| m.len() > 1_500_000).unwrap_or(true) {
            return true;
        }
        let Ok(buf) = fs::read(p) else { return true };
        if files::is_binary(&buf) {
            return true;
        }
        count += 1;
        let body = String::from_utf8_lossy(&buf);
        let lines: Vec<&str> = body.split('\n').collect();
        for i in 0..lines.len() {
            if !re.is_match(lines[i]).unwrap_or(false) {
                continue;
            }
            for k in i.saturating_sub(ctx)..=(i + ctx).min(lines.len() - 1) {
                let short: String = lines[k].chars().take(300).collect();
                results.push(format!("{rel}:{}{} {short}", k + 1, if k == i { ":" } else { "-" }));
            }
            if ctx > 0 {
                results.push("--".into());
            }
            if results.len() >= max {
                return false;
            }
        }
        true
    };
    if single {
        visit(&r.abs);
    } else {
        walk_files(&r.abs, &mut visit);
    }
    let matches = results.iter().filter(|x| *x != "--").count();
    let truncated = results.len() >= max;
    Ok(json!({ "path": r.rel, "files": count, "matches": matches, "text": results.join("\n"), "truncated": truncated }))
}
