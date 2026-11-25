//! Running commands, with the PATH from your own interactive shell.
use super::{files, text, Res};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const MAX_OUTPUT: usize = 60_000;

pub fn user_shell(fallback: &str) -> String {
    let (var, fallback) = if cfg!(windows) { ("ComSpec", "cmd.exe") } else { ("SHELL", fallback) };
    std::env::var(var).ok().filter(|s| !s.is_empty()).unwrap_or_else(|| fallback.to_string())
}

/* ----------------------------- the parts that differ per system ----------------------------- */
#[cfg(unix)]
mod os {
    use std::os::unix::process::{CommandExt, ExitStatusExt};
    use std::process::{Command, ExitStatus};

    /// the child leads its own process group, so killing the group also stops whatever it started
    pub fn prepare(cmd: &mut Command) {
        cmd.process_group(0);
    }
    pub fn kill_tree(pid: u32) {
        unsafe { libc::killpg(pid as i32, libc::SIGKILL) };
    }
    pub fn signal_name(status: &ExitStatus) -> Option<String> {
        status.signal().map(|s| match s {
            libc::SIGKILL => "SIGKILL".to_string(),
            libc::SIGTERM => "SIGTERM".to_string(),
            libc::SIGINT => "SIGINT".to_string(),
            libc::SIGSEGV => "SIGSEGV".to_string(),
            libc::SIGABRT => "SIGABRT".to_string(),
            n => format!("signal {n}"),
        })
    }
    pub fn shell_command(shell: &str, line: &str) -> Command {
        let mut cmd = Command::new(shell);
        cmd.args(["-lc", line]);
        cmd
    }
}

#[cfg(windows)]
mod os {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, ExitStatus};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    /// no console window flashing up for every command
    pub fn prepare(cmd: &mut Command) {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    pub fn kill_tree(pid: u32) {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/pid", &pid.to_string(), "/t", "/f"]);
        prepare(&mut cmd);
        let _ = cmd.status();
    }
    pub fn signal_name(_: &ExitStatus) -> Option<String> {
        None
    }
    pub fn shell_command(shell: &str, line: &str) -> Command {
        let mut cmd = Command::new(shell);
        // passed through untouched: cmd.exe has its own quoting rules
        cmd.args(["/d", "/s", "/c"]).raw_arg(format!("\"{line}\""));
        cmd
    }
}

/// A login shell reads .zprofile but not .zshrc, where most people set PATH (nvm, pyenv, brew, cargo…).
/// So ask your interactive shell for its environment once, and run everything with that.
pub fn shell_env() -> &'static HashMap<String, String> {
    static ENV: OnceLock<HashMap<String, String>> = OnceLock::new();
    ENV.get_or_init(|| {
        // Windows programs already get the full PATH
        if cfg!(windows) {
            return HashMap::new();
        }
        const MARK: &str = "__KOKO_ENV__";
        let mut cmd = Command::new(user_shell("/bin/zsh"));
        cmd.args(["-ilc", &format!("printf '{MARK}'; env -0; printf '{MARK}'")]).env("TERM", "dumb").env("DISABLE_AUTO_UPDATE", "true");
        let mut env = HashMap::new();
        if let Some(out) = capture(cmd, 8000, 4 << 20) {
            if let Some(body) = out.stdout.split(MARK).nth(1) {
                for kv in body.split('\0') {
                    if let Some((k, v)) = kv.split_once('=') {
                        if !k.is_empty() {
                            env.insert(k.to_string(), v.to_string());
                        }
                    }
                }
            }
        }
        if !env.contains_key("PATH") {
            env.clear();
        }
        env
    })
}

pub struct Output {
    pub ok: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

fn drain(mut r: impl Read + Send + 'static, max: usize) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let (mut kept, mut buf) = (Vec::new(), [0u8; 8192]);
        while let Ok(n) = r.read(&mut buf) {
            if n == 0 {
                break;
            }
            if kept.len() < max {
                kept.extend_from_slice(&buf[..n]);
            }
        }
        kept
    })
}

/// Run to completion with a time limit. None when the program could not be started.
pub fn capture(mut cmd: Command, timeout_ms: u64, max: usize) -> Option<Output> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    os::prepare(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    let (out, err) = (drain(child.stdout.take()?, max), drain(child.stderr.take()?, max));
    let end = Instant::now() + Duration::from_millis(timeout_ms);
    let mut timed_out = false;
    while !(out.is_finished() && err.is_finished()) {
        if Instant::now() > end {
            os::kill_tree(child.id());
            timed_out = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(4));
    }
    let status = child.wait().ok()?;
    let take = |h: std::thread::JoinHandle<Vec<u8>>| if timed_out && !h.is_finished() { String::new() } else { String::from_utf8_lossy(&h.join().unwrap_or_default()).into_owned() };
    let (stdout, stderr) = (take(out), take(err));
    Some(Output { ok: status.success() && !timed_out, code: status.code(), stdout, stderr })
}

/// A short helper command with your shell's environment.
pub fn quick(program: &str, args: &[&str], cwd: Option<&std::path::Path>, timeout_ms: u64) -> Option<Output> {
    let mut cmd = Command::new(program);
    cmd.args(args).envs(shell_env());
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    capture(cmd, timeout_ms, 100_000)
}

fn running() -> &'static Mutex<HashMap<String, u32>> {
    static R: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    R.get_or_init(Default::default)
}

pub fn kill(id: &str) -> bool {
    match running().lock().unwrap().get(id) {
        Some(&pid) => {
            os::kill_tree(pid);
            true
        }
        None => false,
    }
}

pub fn kill_all() {
    let pids: HashSet<u32> = running().lock().unwrap().values().copied().collect();
    pids.into_iter().for_each(os::kill_tree);
}

/// The agent's run_command: output is passed to `on_data` as it arrives.
pub fn run(a: &Value, on_data: &mut dyn FnMut(&str)) -> Res {
    let id = text(a, "id").to_string();
    let dir = files::resolve_in(text(a, "cwd"), ".", true)?.abs;
    let mut cmd = os::shell_command(&user_shell("/bin/bash"), text(a, "command"));
    cmd.current_dir(dir).envs(shell_env());
    if let Some(extra) = a.get("env").and_then(Value::as_object) {
        for (k, v) in extra {
            if let Some(v) = v.as_str() {
                cmd.env(k, v);
            }
        }
    }
    cmd.env("TERM", "dumb").env("CI", std::env::var("CI").unwrap_or_else(|_| "1".into())).env("GIT_TERMINAL_PROMPT", "0").env("PAGER", "cat");
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    os::prepare(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Ok(json!({ "exitCode": 127, "signal": null, "output": format!("\n{e}"), "timedOut": false, "killed": false })),
    };
    let pid = child.id();
    running().lock().unwrap().insert(id.clone(), pid);

    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let pipes: [Option<Box<dyn Read + Send>>; 2] = [child.stdout.take().map(|p| Box::new(p) as _), child.stderr.take().map(|p| Box::new(p) as _)];
    for mut p in pipes.into_iter().flatten() {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            while let Ok(n) = p.read(&mut buf) {
                if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
    }
    drop(tx);

    let limit = super::num(a, "timeoutMs").unwrap_or(120_000.0).clamp(1000.0, 600_000.0) as u64;
    let end = Instant::now() + Duration::from_millis(limit);
    let (mut head, mut tail) = (String::new(), String::new());
    let mut total = 0usize;
    let mut timed_out = false;
    let mut carry: Vec<u8> = Vec::new();
    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(bytes) => {
                carry.extend_from_slice(&bytes);
                // keep a character that is split across two reads for the next one
                let cut = match std::str::from_utf8(&carry) {
                    Err(e) if e.error_len().is_none() => e.valid_up_to(),
                    _ => carry.len(),
                };
                let s = String::from_utf8_lossy(&carry[..cut]).into_owned();
                carry.drain(..cut);
                total += s.chars().count();
                if head.len() < MAX_OUTPUT * 2 {
                    head.push_str(&s);
                }
                tail.push_str(&s);
                if tail.len() > MAX_OUTPUT * 2 {
                    let mut at = tail.len() - MAX_OUTPUT;
                    while !tail.is_char_boundary(at) {
                        at += 1;
                    }
                    tail.drain(..at);
                }
                on_data(&s);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if !timed_out && Instant::now() > end {
            timed_out = true;
            os::kill_tree(pid);
        }
        // something that left the process group can hold the pipes open forever: stop waiting a little after the kill
        if timed_out && Instant::now() > end + Duration::from_secs(3) {
            break;
        }
    }
    let status = child.wait()?;
    running().lock().unwrap().remove(&id);
    let signal = os::signal_name(&status);
    let output = if head.chars().count() > MAX_OUTPUT {
        let first: String = head.chars().take(MAX_OUTPUT / 2).collect();
        let n = tail.chars().count();
        let last: String = tail.chars().skip(n.saturating_sub(MAX_OUTPUT / 2)).collect();
        format!("{first}\n…[{} characters omitted]…\n{last}", total - MAX_OUTPUT)
    } else {
        head
    };
    let killed = signal.as_deref() == Some("SIGKILL") && !timed_out;
    Ok(json!({ "exitCode": status.code(), "signal": signal, "output": output, "timedOut": timed_out, "killed": killed }))
}

