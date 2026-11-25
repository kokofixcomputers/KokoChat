//! A Rust port of electron/tools.cjs and electron/checkpoints.cjs. Operations take and return the same JSON as the Electron bridge,
//! so the interface (the same React code) cannot tell the two shells apart.
pub mod checkpoints;
pub mod files;
pub mod git;
pub mod migrate;
pub mod search;
pub mod shell;

use serde_json::{json, Value};

#[derive(Debug)]
pub struct ToolError {
    pub message: String,
    pub code: &'static str,
}
impl ToolError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { message: message.into(), code }
    }
}
impl From<std::io::Error> for ToolError {
    fn from(e: std::io::Error) -> Self {
        Self::new("ERR", e.to_string())
    }
}
pub type Res = Result<Value, ToolError>;

pub fn text<'a>(a: &'a Value, k: &str) -> &'a str {
    a.get(k).and_then(Value::as_str).unwrap_or("")
}
pub fn flag(a: &Value, k: &str) -> bool {
    a.get(k).and_then(Value::as_bool).unwrap_or(false)
}
pub fn num(a: &Value, k: &str) -> Option<f64> {
    a.get(k).and_then(Value::as_f64)
}

/// Run one operation by the name the bridge uses. Blocking: call it from a worker thread.
pub fn dispatch(op: &str, a: &Value) -> Res {
    match op {
        "fs:read" => files::read(a),
        "fs:write" => checkpoints::tracked(a, files::write),
        "fs:append" => checkpoints::tracked(a, files::append),
        "fs:edit" => checkpoints::tracked(a, files::edit),
        "fs:writeBase64" => checkpoints::tracked(a, files::write_base64),
        "fs:list" => search::list(a),
        "fs:find" => search::find(a),
        "fs:search" => search::search(a),
        "fs:tree" => search::tree(a),
        "fs:readRaw" => files::read_raw(a),
        "project:context" => git::project_context(a),
        "git:status" => git::status(a),
        "git:diff" => git::diff(a),
        "git:stage" => git::stage(a),
        "git:unstage" => git::unstage(a),
        "git:discard" => git::discard(a),
        "git:commit" => git::commit(a),
        "git:branches" => git::branches(a),
        "git:checkout" => git::checkout(a),
        "git:push" => git::push(a),
        "git:pull" => git::pull(a),
        "git:log" => git::log(a),
        "git:changes" => git::change_text(a),
        "git:branchchanges" => git::branch_changes(a),
        "checkpoint:info" => checkpoints::info(a),
        "checkpoint:revert" => checkpoints::revert(a),
        _ => Err(ToolError::new("ERR", format!("Unknown operation {op}"))),
    }
}

/// The `{ok, data}` / `{ok:false, error}` envelope the interface expects.
pub fn reply(r: Res) -> Value {
    match r {
        Ok(data) => json!({ "ok": true, "data": data }),
        Err(e) => json!({ "ok": false, "error": { "message": e.message, "code": e.code } }),
    }
}
