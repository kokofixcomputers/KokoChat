//! Git status, diffs and actions, plus what the agent is told about the project folder.
use super::{files, flag, num, shell, text, Res, ToolError};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn dir(a: &Value) -> Result<PathBuf, ToolError> {
    Ok(files::resolve_in(text(a, "cwd"), ".", true)?.abs)
}

fn command(cwd: &PathBuf, args: &[&str]) -> Command {
    let mut c = Command::new("git");
    c.args(args).current_dir(cwd).envs(shell::shell_env()).env("LC_ALL", "C").env("GIT_TERMINAL_PROMPT", "0").env("GIT_OPTIONAL_LOCKS", "0");
    c
}

fn run(cwd: &PathBuf, args: &[&str], ok_codes: &[i32], timeout_ms: u64) -> Result<shell::Output, ToolError> {
    let out = shell::capture(command(cwd, args), timeout_ms, 8 << 20).ok_or_else(|| ToolError::new("GIT", "git could not be started."))?;
    if out.ok || out.code.is_some_and(|c| ok_codes.contains(&c)) {
        return Ok(out);
    }
    let msg = [out.stderr.trim(), out.stdout.trim()].into_iter().find(|s| !s.is_empty()).unwrap_or("git failed");
    Err(ToolError::new("GIT", msg.chars().take(600).collect::<String>()))
}
fn git(cwd: &PathBuf, args: &[&str]) -> Result<String, ToolError> {
    run(cwd, args, &[], 60_000).map(|o| o.stdout)
}

pub fn status(a: &Value) -> Res {
    let abs = dir(a)?;
    let Ok(out) = git(&abs, &["status", "--porcelain=v1", "-b", "-uall"]) else { return Ok(json!({ "isRepo": false, "files": [] })) };
    let mut lines: Vec<&str> = out.split('\n').filter(|l| !l.is_empty()).collect();
    let head = if lines.first().is_some_and(|l| l.starts_with("## ")) { &lines.remove(0)[3..] } else { "" };
    let mut parts = head.split("...");
    let first = parts.next().unwrap_or("");
    let branch = first.strip_prefix("No commits yet on ").unwrap_or(first);
    let upstream = parts.next().and_then(|u| u.split(' ').next()).unwrap_or("");
    let count = |word: &str| head.split(word).nth(1).and_then(|r| r.trim_start().split(|c: char| !c.is_ascii_digit()).next()?.parse::<u64>().ok()).unwrap_or(0);
    let mut stats: Map<String, Value> = Map::new();
    if let Ok(o) = run(&abs, &["diff", "--numstat", "HEAD"], &[128], 60_000) {
        for l in o.stdout.split('\n') {
            let mut f = l.splitn(3, '\t');
            if let (Some(add), Some(del), Some(path)) = (f.next(), f.next(), f.next()) {
                stats.insert(path.to_string(), json!([add.parse::<u64>().unwrap_or(0), del.parse::<u64>().unwrap_or(0)]));
            }
        }
    }
    let list: Vec<Value> = lines
        .iter()
        .filter(|l| l.len() > 3)
        .map(|l| {
            let mut c = l.chars();
            let (x, y) = (c.next().unwrap_or(' '), c.next().unwrap_or(' '));
            let mut f = l.get(3..).unwrap_or("");
            if let Some(i) = f.find(" -> ") {
                f = &f[i + 4..];
            }
            let f = f.strip_prefix('"').unwrap_or(f);
            let f = f.strip_suffix('"').unwrap_or(f);
            let untracked = x == '?';
            let st = if untracked { 'U' } else if x != ' ' { x } else { y };
            let mut v = json!({ "path": f, "status": st.to_string(), "staged": !untracked && x != ' ', "unstaged": untracked || y != ' ' });
            if let Some(s) = stats.get(f) {
                v["added"] = s[0].clone();
                v["removed"] = s[1].clone();
            }
            v
        })
        .collect();
    Ok(json!({ "isRepo": true, "branch": branch, "upstream": upstream, "ahead": count("ahead "), "behind": count("behind "), "files": list }))
}

/// A unified diff of one file against the last commit (new files are shown in full).
pub fn diff(a: &Value) -> Res {
    let abs = dir(a)?;
    let p = text(a, "path");
    if text(a, "status") == "U" {
        let raw = files::read_raw(&json!({ "cwd": text(a, "cwd"), "path": p }))?;
        let Some(t) = raw.get("text").and_then(Value::as_str) else { return Ok(json!({ "binary": true, "text": "" })) };
        let body = t.strip_suffix('\n').unwrap_or(t).split('\n').map(|l| format!("+{l}")).collect::<Vec<_>>().join("\n");
        return Ok(json!({ "text": body, "truncated": raw["truncated"], "untracked": true }));
    }
    let out = run(&abs, &["diff", "HEAD", "--no-color", "-U3", "--", p], &[1], 60_000).or_else(|_| run(&abs, &["diff", "--no-color", "-U3", "--", p], &[1], 60_000))?.stdout;
    if out.lines().any(|l| l.starts_with("Binary files")) {
        return Ok(json!({ "binary": true, "text": "" }));
    }
    let truncated = out.chars().count() > 300_000;
    Ok(json!({ "text": out.chars().take(300_000).collect::<String>(), "truncated": truncated }))
}

fn safe_paths(a: &Value) -> Vec<String> {
    a.get("paths").and_then(Value::as_array).map(|v| v.iter().filter_map(Value::as_str).filter(|p| !p.is_empty() && !p.starts_with('-')).take(2000).map(String::from).collect()).unwrap_or_default()
}
fn with_paths(cwd: &PathBuf, head: &[&str], paths: &[String]) -> Result<String, ToolError> {
    let mut args: Vec<&str> = head.to_vec();
    args.extend(paths.iter().map(String::as_str));
    git(cwd, &args)
}

pub fn stage(a: &Value) -> Res {
    let abs = dir(a)?;
    if flag(a, "all") {
        git(&abs, &["add", "-A"])?;
    } else {
        let p = safe_paths(a);
        if !p.is_empty() {
            with_paths(&abs, &["add", "--"], &p)?;
        }
    }
    Ok(json!(true))
}
pub fn unstage(a: &Value) -> Res {
    let abs = dir(a)?;
    let p = if flag(a, "all") { vec![".".to_string()] } else { safe_paths(a) };
    if with_paths(&abs, &["restore", "--staged", "--"], &p).is_err() {
        with_paths(&abs, &["rm", "--cached", "-r", "-q", "--"], &p)?; // no commits yet: nothing to restore from
    }
    Ok(json!(true))
}
/// Throw away changes: tracked files go back to the last commit, untracked ones are deleted.
pub fn discard(a: &Value) -> Res {
    let p = safe_paths(a);
    if p.is_empty() {
        return Ok(json!(true));
    }
    let abs = dir(a)?;
    let st = status(a)?;
    let untracked: Vec<&str> = st["files"].as_array().into_iter().flatten().filter(|f| f["status"] == "U").filter_map(|f| f["path"].as_str()).collect();
    let (fresh, tracked): (Vec<String>, Vec<String>) = p.into_iter().partition(|x| untracked.contains(&x.as_str()));
    if !tracked.is_empty() {
        with_paths(&abs, &["restore", "--source=HEAD", "--staged", "--worktree", "--"], &tracked)?;
    }
    for f in fresh {
        let target = files::resolve_in(text(a, "cwd"), &f, false)?.abs;
        let _ = if target.is_dir() { fs::remove_dir_all(target) } else { fs::remove_file(target) };
    }
    Ok(json!(true))
}
pub fn commit(a: &Value) -> Res {
    let msg = text(a, "message").trim().to_string();
    if msg.is_empty() {
        return Err(ToolError::new("EMPTY", "Write a commit message first."));
    }
    let abs = dir(a)?;
    if flag(a, "stageAll") {
        git(&abs, &["add", "-A"])?;
    }
    if git(&abs, &["diff", "--cached", "--name-only"])?.trim().is_empty() {
        return Err(ToolError::new("NOTHING", "Nothing is staged to commit."));
    }
    let out = run(&abs, &["commit", "-m", &msg], &[], 120_000).map_err(|e| ToolError::new("COMMIT", e.message))?.stdout;
    let hash = git(&abs, &["rev-parse", "--short", "HEAD"])?.trim().to_string();
    let summary = out.lines().find(|l| l.contains(" changed") && l.contains("file")).map(str::trim).unwrap_or("");
    Ok(json!({ "hash": hash, "summary": summary }))
}
pub fn branches(a: &Value) -> Res {
    let out = git(&dir(a)?, &["branch", "--format=%(HEAD)|%(refname:short)|%(upstream:short)"])?;
    let list: Vec<Value> = out
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|l| {
            let mut f = l.split('|');
            let (head, name, up) = (f.next()?, f.next()?, f.next().unwrap_or(""));
            if name.starts_with('(') && name.ends_with(')') {
                return None;
            }
            Some(json!({ "name": name, "current": head == "*", "upstream": up }))
        })
        .collect();
    Ok(json!({ "branches": list }))
}
pub fn checkout(a: &Value) -> Res {
    let b = text(a, "branch").trim();
    let word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let valid = b.chars().next().is_some_and(word) && b.len() <= 101 && b.chars().all(|c| word(c) || "./-".contains(c)) && !b.contains("..");
    if !valid {
        return Err(ToolError::new("BADNAME", "That is not a valid branch name."));
    }
    let abs = dir(a)?;
    if flag(a, "create") {
        git(&abs, &["switch", "-c", b])?;
    } else {
        git(&abs, &["switch", b])?;
    }
    Ok(json!(true))
}

fn network(abs: &PathBuf, args: &[&str]) -> Result<String, ToolError> {
    let o = run(abs, args, &[], 90_000)?;
    Ok(if o.stderr.trim().is_empty() { o.stdout } else { o.stderr }.trim().to_string())
}
pub fn push(a: &Value) -> Res {
    let st = status(a)?;
    let args: &[&str] = if st["upstream"].as_str().is_some_and(|u| !u.is_empty()) { &["push"] } else { &["push", "-u", "origin", "HEAD"] };
    let out = network(&dir(a)?, args)?;
    Ok(json!({ "output": if out.is_empty() { "Pushed.".into() } else { out } }))
}
pub fn pull(a: &Value) -> Res {
    let out = network(&dir(a)?, &["pull", "--ff-only"])?;
    Ok(json!({ "output": if out.is_empty() { "Up to date.".into() } else { out } }))
}
pub fn log(a: &Value) -> Res {
    let n = num(a, "n").unwrap_or(12.0).clamp(1.0, 50.0) as u32;
    let out = git(&dir(a)?, &["log", &format!("-{n}"), "--format=%h%x1f%s%x1f%an%x1f%cr"])?;
    let commits: Vec<Value> = out
        .split('\n')
        .filter(|l| !l.is_empty())
        .map(|l| {
            let f: Vec<&str> = l.split('\x1f').collect();
            json!({ "hash": f.first(), "subject": f.get(1), "author": f.get(2), "when": f.get(3) })
        })
        .collect();
    Ok(json!({ "commits": commits }))
}
fn capped(s: String, max: usize) -> String {
    if s.chars().count() > max {
        s.chars().take(max).collect::<String>() + "\n…[diff truncated]"
    } else {
        s
    }
}
/// Everything on this branch that the base branch does not have yet (for a pull request description).
pub fn branch_changes(a: &Value) -> Res {
    let abs = dir(a)?;
    let base = ["origin/HEAD", "origin/main", "origin/master", "main", "master"].into_iter().find(|c| git(&abs, &["rev-parse", "--verify", "-q", c]).is_ok()).unwrap_or("");
    let cur = git(&abs, &["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_string();
    if base.is_empty() || base.replacen("origin/", "", 1) == cur {
        return Err(ToolError::new("NOBASE", "Switch to a feature branch first: there is no other branch to compare with."));
    }
    let log = git(&abs, &["log", &format!("{base}..HEAD"), "--format=%s%n%b---"])?;
    let range = format!("{base}...HEAD");
    let stat = git(&abs, &["diff", &range, "--stat", "--no-color"])?;
    let diff = git(&abs, &["diff", &range, "--no-color", "-U1"])?;
    Ok(json!({ "base": base, "branch": cur, "log": log.trim(), "stat": stat.trim(), "diff": capped(diff, 20000) }))
}
/// The change text the AI reads to write a commit message: staged changes, or everything if nothing is staged.
pub fn change_text(a: &Value) -> Res {
    let abs = dir(a)?;
    let soft = |args: &[&str]| git(&abs, args).unwrap_or_default();
    let staged = git(&abs, &["diff", "--cached", "--stat", "--no-color"])?.trim().to_string();
    let use_staged = !staged.is_empty();
    let stat = if use_staged { staged } else { soft(&["diff", "HEAD", "--stat", "--no-color"]).trim().to_string() };
    let mut diff = if use_staged { git(&abs, &["diff", "--cached", "--no-color", "-U2"])? } else { soft(&["diff", "HEAD", "--no-color", "-U2"]) };
    let untracked = git(&abs, &["ls-files", "--others", "--exclude-standard"])?;
    let new: Vec<&str> = untracked.lines().filter(|l| !l.is_empty()).take(40).collect();
    if !use_staged && !new.is_empty() {
        diff.push_str(&format!("\n\nNew files (not yet tracked): {}", new.join(", ")));
    }
    Ok(json!({ "stat": stat, "diff": capped(diff, 24000), "recent": soft(&["log", "-8", "--format=%s"]).trim(), "staged": use_staged }))
}

pub fn project_context(a: &Value) -> Res {
    let abs = dir(a)?;
    let mut instructions = String::new();
    for name in ["CLAUDE.md", "AGENTS.md", ".koko/instructions.md"] {
        if let Ok(t) = fs::read_to_string(abs.join(name)) {
            instructions = format!("# {name}\n{}", t.chars().take(12_000).collect::<String>());
            break;
        }
    }
    let mut top: Vec<String> = fs::read_dir(&abs).map(|r| r.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n != ".DS_Store").collect()).unwrap_or_default();
    top.sort();
    top.truncate(60);
    let branch = git(&abs, &["rev-parse", "--abbrev-ref", "HEAD"]).map(|s| s.trim().to_string()).unwrap_or_default();
    let dirty = git(&abs, &["status", "--short"]).map(|s| s.lines().filter(|l| !l.is_empty()).count()).unwrap_or(0);
    let git_info = if branch.is_empty() { Value::Null } else { json!({ "branch": branch, "dirty": dirty }) };
    let platform = if cfg!(target_os = "macos") { "darwin" } else if cfg!(windows) { "win32" } else { "linux" };
    Ok(json!({ "cwd": abs.to_string_lossy(), "instructions": instructions.trim(), "top": top, "git": git_info, "platform": platform, "shell": shell::user_shell("sh"), "home": files::home().to_string_lossy() }))
}
