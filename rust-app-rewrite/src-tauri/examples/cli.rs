//! For tests: reads one JSON request per line ({"op": "...", "args": {...}}) and prints the reply envelope.
use koko_tauri::core;
use std::io::{BufRead, Write};

fn main() {
    core::checkpoints::init(std::env::args().nth(1).map(Into::into).unwrap_or_else(|| std::env::temp_dir().join("koko-cli-checkpoints")));
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        let req: serde_json::Value = serde_json::from_str(&line).expect("bad request");
        let (op, args) = (req["op"].as_str().unwrap_or(""), &req["args"]);
        let out = if op == "shell:run" {
            let mut streamed = String::new();
            let mut r = core::reply(core::shell::run(args, &mut |c| streamed.push_str(c)));
            r["streamed"] = streamed.into();
            r
        } else {
            core::reply(core::dispatch(op, args))
        };
        println!("{out}");
        std::io::stdout().flush().ok();
    }
}
