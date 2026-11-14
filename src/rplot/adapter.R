# 浏览器适配：图形引擎与 CeTZ 序列化仍用 cetzDevice 0.5.3.1。
# 原包以 system2 调 Typst CLI 量字，这里改成批量收集表达式、由主线程的 Typst/Wasm 精确测量后重放。
.iota_metrics <- list()
.iota_missing <- new.env(parent = emptyenv())
.iota_backend <- function(state, backend, typst) {
  function(string, style) {
    plain <- is.integer(string)
    if (plain) string <- intToUtf8(if (string == 0L) 77L else string)
    if (!nzchar(string)) return(c(0, 0, 0))
    expression <- cetzDevice:::.text_expr(string, style, state, plain = plain)
    key <- digest::digest(expression, algo = "xxhash64")
    cached <- .iota_metrics[[key]]
    if (!is.null(cached)) return(as.double(cached))
    .iota_missing[[key]] <- expression
    # 仅用于第一次收集度量；精确测量收齐以前不会让图进入工程。
    c(nchar(string, type = "width") * style$size * 0.55, style$size * 0.8, style$size * 0.2)
  }
}

.iota_try_draw <- function(...) tryCatch(.iota_draw(...), error = function(e) {
  message <- conditionMessage(e)
  if (!grepl("figure margins too large|figure region too large|plot region too large", message, ignore.case = TRUE)) stop(e)
  jsonlite::toJSON(list(layoutError = message, missing = as.list(.iota_missing)), auto_unbox = TRUE)
})
.iota_ns <- asNamespace("cetzDevice")
unlockBinding(".metric_backend", .iota_ns)
assign(".metric_backend", .iota_backend, envir = .iota_ns)
lockBinding(".metric_backend", .iota_ns)

.iota_draw <- function(code, width, height, pointsize, seed, auto_font = FALSE) {
  .iota_missing <<- new.env(parent = emptyenv())
  file <- "/tmp/iota-rplot.typ"
  # 入口的 CLI 文件检查保留；度量后端已替换，不会执行这个文件。
  writeLines("webR Typst/Wasm metric bridge", "/tmp/iota-typst")
  if (grDevices::dev.cur() > 1L) grDevices::graphics.off()
  set.seed(as.integer(seed))
  cetzDevice::cetz(file, width = width, height = height, pointsize = pointsize,
    family = "TeX Gyre Termes", typst = "/tmp/iota-typst", metrics = "typst",
    font_map = c(sans = "TeX Gyre Heros", serif = "TeX Gyre Termes", mono = "DejaVu Sans Mono"),
    standalone = FALSE)
  device <- grDevices::dev.cur()
  state <- cetzDevice:::.devices[[as.character(device)]]
  restore_fonts <- .iota_font_defaults(pointsize, auto_font)
  on.exit(restore_fonts(), add = TRUE)
  environment <- new.env(parent = globalenv())
  on.exit(if (grDevices::dev.cur() > 1L) grDevices::graphics.off(), add = TRUE)
  logs <- capture.output({
    for (expression in parse(text = code)) {
      expression <- .iota_font_calls(expression, pointsize, auto_font)
      value <- withVisible(eval(expression, envir = environment))
      if (value$visible) print(value$value)
    }
  })
  labels <- .iota_label_boxes(state)
  if (device %in% grDevices::dev.list()) grDevices::dev.off(device)
  if (!is.null(state$error)) stop(state$error)
  if (!length(state$pages)) stop("R 代码没有画出图；请使用 plot()、print(ggplot(...)) 等绘图语句")
  jsonlite::toJSON(list(source = paste(readLines(file, warn = FALSE), collapse = "\n"),
    missing = as.list(.iota_missing), pages = length(state$pages), labels = labels, stdout = paste(logs, collapse = "\n")),
    auto_unbox = TRUE, null = "null")
}
