# 复用 languageserver 的真实 LSP handler；transport、任务调度与悬停帮助适配浏览器。
# 浏览器没有 callr 子进程；分析任务在专用 R worker 内串行执行，不占用绘图 worker。
.iota_lsp_ns <- asNamespace("languageserver")
# 不调用 rmarkdown/pandoc 探测（浏览器没有外部可执行程序）。
.iota_lsp_ns$lsp_settings$set("rich_documentation", FALSE)
.iota_lsp_ns$lsp_settings$set("index_mode", "off")
# 桌面帮助路径可能启动动态帮助/外部渲染器；浏览器悬停直接使用同一 Workspace 的真实函数签名。
.iota_lsp_ns$Workspace$set("public", "get_help", function(topic, pkgname = NULL, uri = NULL) {
  if (is.null(pkgname)) pkgname <- self$guess_namespace(topic, uri = uri)
  sig <- self$get_signature(topic, pkgname, uri = uri)
  if (is.null(sig)) character() else paste0("```r\n", sig, "\n```")
}, overwrite = TRUE)
.iota_lsp_replace <- function(name, value) {
  unlockBinding(name, .iota_lsp_ns)
  assign(name, value, envir = .iota_lsp_ns)
  lockBinding(name, .iota_lsp_ns)
}
.iota_lsp_replace("create_task", function(target, args, callback = NULL, error = NULL, delay = 0) {
  list(run = function() tryCatch({ value <- do.call(target, args); if (!is.null(callback)) callback(value) }, error = function(e) { if (!is.null(error)) error(e) else stop(e) }))
})
.iota_lsp_replace("TaskManager", R6::R6Class("IotaBrowserTasks", public = list(
  pending = NULL,
  initialize = function(...) self$pending <- list(),
  add_task = function(id, task) { if (!is.null(task)) self$pending[[id]] <- task },
  cancel = function(id) self$pending[[id]] <- NULL,
  check_tasks = function() invisible(NULL),
  run_tasks = function() { tasks <- self$pending; self$pending <- list(); for (task in tasks) task$run() },
  has_work = function() length(self$pending) > 0L,
  stop = function() self$pending <- list()
)))
.iota_lsp_messages <- list()
.iota_lsp_ns$LanguageServer$set("public", "deliver", function(message, callback = NULL) {
  if (is.null(message)) return(invisible(NULL))
  payload <- list(jsonrpc = "2.0")
  if (!is.null(message$method)) {
    payload$method <- message$method
    if (!is.null(message$params)) payload$params <- message$params
    if (!is.null(message$id)) payload$id <- message$id
  } else {
    payload$id <- message$id
    if (!is.null(message$error)) payload$error <- message$error else payload["result"] <- list(message$result)
  }
  .iota_lsp_messages[[length(.iota_lsp_messages) + 1L]] <<- payload
  if (inherits(message, "Request") && !is.null(callback)) self$request_callbacks$set(as.character(message$id), callback)
  invisible(NULL)
}, overwrite = TRUE)
.iota_lsp_server <- .iota_lsp_ns$LanguageServer$new(host = "localhost", port = NULL)
.iota_lsp_send <- function(json) {
  .iota_lsp_messages <<- list()
  payload <- jsonlite::fromJSON(json, simplifyVector = FALSE)
  uri <- payload$params$textDocument$uri
  path <- if (is.null(uri)) "" else sub("^file://", "", uri)
  if (startsWith(path, "/home/web_user/")) {
    text <- if (payload$method == "textDocument/didOpen") payload$params$textDocument$text else if (payload$method == "textDocument/didChange") payload$params$contentChanges[[1L]]$text else NULL
    if (!is.null(text)) writeLines(text, path, useBytes = TRUE)
  }
  .iota_lsp_server$handle_raw(json)
  # 一个 parse callback 可能再排入 diagnostics/namespace resolve；有界排空，不进入阻塞 run()。
  for (i in seq_len(8L)) {
    managers <- list(.iota_lsp_server$parse_task_manager, .iota_lsp_server$resolve_task_manager, .iota_lsp_server$diagnostics_task_manager, .iota_lsp_server$formatting_task_manager)
    for (manager in managers) if (!is.null(manager)) manager$run_tasks()
    if (!any(vapply(managers, function(m) !is.null(m) && m$has_work(), logical(1L)))) break
  }
  as.character(jsonlite::toJSON(.iota_lsp_messages, auto_unbox = TRUE, null = "null", force = TRUE))
}
.iota_lsp_safe_send <- function(json) tryCatch(.iota_lsp_send(json), error = function(e) {
  payload <- jsonlite::fromJSON(json, simplifyVector = FALSE)
  as.character(jsonlite::toJSON(list(list(jsonrpc = "2.0", id = payload$id, error = list(code = -32603L, message = paste(conditionMessage(e), paste(deparse(conditionCall(e)), collapse = " "))))), auto_unbox = TRUE, null = "null"))
})
