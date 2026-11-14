# 只改默认值：显式 pointsize、gpar(fontsize)、element_text(size)、geom_text(size) 原样交给 R。
.iota_text_theme <- function(size, theme) {
  element <- ggplot2::element_text(size = size)
  parts <- c("text", "axis.text", "axis.title", "legend.text", "legend.title", "strip.text", "plot.title", "plot.subtitle", "plot.caption", "plot.tag")
  visible <- vapply(parts, function(part) !inherits(ggplot2::calc_element(part, theme), c("element_blank", "ggplot2::element_blank")), logical(1L))
  changes <- setNames(rep(list(element), sum(visible)), parts[visible])
  changes$geom <- ggplot2::element_geom(fontsize = size)
  do.call(ggplot2::theme, changes)
}
.iota_auto_theme <- function(fn, size, ...) {
  args <- list(...)
  if (!identical(environment(fn), asNamespace("ggplot2"))) return(do.call(fn, args))
  # 各内置主题的首个位置参数都是 base_size；用户明确给过就完整保留其相对字号。
  names <- names(args)
  explicit <- length(args) && (is.null(names) || any(!nzchar(names)) || "base_size" %in% names)
  if (explicit) return(do.call(fn, args))
  theme <- do.call(fn, c(list(base_size = size), args))
  theme + .iota_text_theme(size, theme)
}
.iota_base_layout <- function(fn, ...) {
  args <- list(...)
  if (!identical(environment(fn), asNamespace("graphics"))) return(do.call(fn, args))
  values <- if (length(args) == 1L && is.list(args[[1L]])) args[[1L]] else args
  is_par <- identical(fn, graphics::par)
  reset <- !is_par || (any(c("mfrow", "mfcol") %in% names(values)) && !"cex" %in% names(values))
  value <- withVisible(do.call(fn, args))
  # R 的多面板布局会隐式把 cex 降为 .83/.66；自动模式不据此把能排下的五号缩小。
  if (reset) graphics::par(cex = 1)
  if (value$visible) value$value else invisible(value$value)
}
.iota_text_geom <- function(.iota_fn, ...) {
  args <- list(...)
  name <- if (identical(.iota_fn, ggplot2::geom_text)) "geom_text" else if (identical(.iota_fn, ggplot2::geom_label)) "geom_label" else NULL
  if (is.null(name)) return(do.call(.iota_fn, args))
  layer <- do.call(name, args, envir = asNamespace("ggplot2"))
  if (!is.null(args[["size"]])) return(layer)
  unit <- args[["size.unit"]]
  if (is.null(unit) || identical(unit, "mm")) return(layer)
  factor <- switch(unit, pt = 1, cm = ggplot2::.pt * 10, `in` = ggplot2::.pt * 25.4, pc = 12, NULL)
  if (is.null(factor)) return(layer)
  # 只改这一层的默认值；映射到 size 的数据、显式 size 和其他文字层都不受影响。
  parent <- layer$geom
  defaults <- parent$default_aes
  value <- defaults[["size"]]
  if (!rlang::is_quosure(value)) return(layer)
  expression <- rlang::quo_get_expr(value)
  if (!rlang::is_call(expression, "from_theme")) return(layer)
  expression[[2L]] <- call("*", expression[[2L]], ggplot2::.pt / factor)
  defaults$size <- rlang::new_quosure(expression, rlang::quo_get_env(value))
  layer$geom <- ggplot2::ggproto(NULL, parent, default_aes = defaults)
  layer
}
.iota_font_calls <- function(expr, size, auto_font = TRUE) {
  if (!is.call(expr)) return(expr)
  head <- expr[[1L]]
  if (is.symbol(head) && as.character(head) %in% c("quote", "substitute", "expression", "bquote")) return(expr)
  if (is.call(head) && (identical(head[[1L]], as.name("::")) || identical(head[[1L]], as.name(":::")))) {
    package <- as.character(head[[2L]]); fun <- as.character(head[[3L]])
    if (package == "base" && fun %in% c("quote", "substitute", "expression", "bquote")) return(expr)
    if (package == "rlang" && fun %in% c("expr", "exprs", "quo", "quos", "enquo", "enquos", "ensym", "ensyms")) return(expr)
  }
  name <- if (is.symbol(head)) as.character(head) else if (is.call(head) && identical(head[[1L]], as.name("::")) && as.character(head[[2L]]) %in% c("ggplot2", "graphics")) as.character(head[[3L]]) else ""
  themes <- c("theme_gray", "theme_grey", "theme_bw", "theme_linedraw", "theme_light", "theme_dark", "theme_minimal", "theme_classic", "theme_void", "theme_test")
  parts <- as.list(expr); has_missing <- FALSE
  if (length(parts) > 1L) for (i in seq.int(2L, length(parts))) {
    arg <- parts[[i]]
    if (missing(arg)) { has_missing <- TRUE; next }
    # [[<- NULL 会删掉参数；用单括号赋值完整保留 NULL 和参数位置。
    parts[i] <- list(.iota_font_calls(arg, size, auto_font))
  }
  expr <- as.call(parts)
  if (name %in% themes && !has_missing) return(as.call(c(list(.iota_auto_theme, head, size), parts[-1L])))
  if (name %in% c("geom_text", "geom_label") && !has_missing) return(as.call(c(list(.iota_text_geom, head), parts[-1L])))
  if (auto_font && name %in% c("par", "layout") && !has_missing) return(as.call(c(list(.iota_base_layout, head), parts[-1L])))
  expr
}
.iota_font_defaults <- function(size, auto_font = TRUE) {
  # 返回还原函数，每次量字重放都独立设置，不能改变下一张图的主题/geom 默认值。
  if (auto_font) graphics::par(cex.main = 1, cex.lab = 1, cex.axis = 1, cex.sub = 1)
  if (!"ggplot2" %in% loadedNamespaces()) return(function() invisible(NULL))
  old <- ggplot2::theme_get()
  ggplot2::theme_set(old + .iota_text_theme(size, old))
  geoms <- list(ggplot2::GeomText, ggplot2::GeomLabel)
  if ("ggrepel" %in% loadedNamespaces()) geoms <- c(geoms, list(ggrepel::GeomTextRepel, ggrepel::GeomLabelRepel))
  defaults <- lapply(geoms, function(g) g$default_aes)
  for (g in geoms) {
    value <- g$default_aes[["size"]]
    if (rlang::is_quosure(value) && "from_theme" %in% all.names(rlang::quo_get_expr(value))) next
    aes <- g$default_aes
    aes$size <- rlang::new_quosure(quote(from_theme(fontsize)), asNamespace("ggplot2"))
    g$default_aes <- aes
  }
  function() {
    ggplot2::theme_set(old)
    for (i in seq_along(geoms)) geoms[[i]]$default_aes <- defaults[[i]]
    invisible(NULL)
  }
}
.iota_label_boxes <- function(state) {
  out <- list(); clip <- c(0, state$width, 0, state$height)
  for (i in seq_len(state$count)) {
    op <- state$ops[[as.character(i)]]
    if (op$kind == "clip") { clip <- op$data; next }
    if (op$kind != "text" || substr(op$style$col, 8L, 9L) == "00") next
    at <- op$data[[1L]]; label <- op$data[[2L]]; m <- state$measure(label, op$style)
    a <- at[3L] * pi / 180
    out[[length(out) + 1L]] <- list(label = label, size = op$style$size,
      x = at[1L] - at[4L] * m[1L] * cos(a), y = at[2L] - at[4L] * m[1L] * sin(a),
      width = m[1L], ascent = m[2L], descent = m[3L], angle = at[3L],
      clip = c(max(0, min(clip[1:2])), min(state$width, max(clip[1:2])), max(0, min(clip[3:4])), min(state$height, max(clip[3:4]))))
  }
  out
}
