# 在 ghcr.io/r-wasm/webr:v0.6.1 的交叉编译环境里运行。
# 不依赖 pkgdepends 的 GitHub/本地包解析（上游当前版本对这份 DESCRIPTION 会解析失败）。
options(repos = c(CRAN = "https://cloud.r-project.org"))
if (!requireNamespace("rwasm", quietly = TRUE)) pak::pak("r-wasm/rwasm")
install.packages(c("digest", "jsonlite", "png"))
dir.create("_r-wasm", showWarnings = FALSE)
dir.create("_r-wasm-image", showWarnings = FALSE)
work <- tempfile()
dir.create(work)
fs::dir_copy(".cetzDevice-source", file.path(work, "cetzDevice"))
archive <- file.path(normalizePath("_r-wasm"), "cetzDevice-source.tar.gz")
withr::with_dir(work, utils::tar(archive, "cetzDevice", compression = "gzip"))
rwasm:::wasm_build("cetzDevice", archive, normalizePath("_r-wasm"), compress = FALSE)
lib <- tempfile()
dir.create(lib)
utils::untar("_r-wasm/cetzDevice_0.5.3.1.tgz", exdir = lib)
version <- getOption("rwasm.webr_version")
rv <- strsplit(as.character(version), "\\.")[[1]]
repo <- paste0("https://repo.r-wasm.org/bin/emscripten/contrib/", paste(rv[1:2], collapse = "."), "/")
index <- read.dcf(gzcon(url(paste0(repo, "PACKAGES.gz"))))
base_packages <- c("R", "base", "compiler", "datasets", "graphics", "grDevices", "grid", "methods", "parallel", "splines", "stats", "stats4", "tools", "utils")
pending <- c("digest", "jsonlite", "png", "ggplot2")
included <- character()
while (length(pending)) {
  name <- pending[[1L]]
  pending <- pending[-1L]
  if (name %in% c(base_packages, included)) next
  row <- index[index[, "Package"] == name, , drop = FALSE]
  stopifnot(nrow(row) == 1L)
  deps <- intersect(c("Depends", "Imports", "LinkingTo"), colnames(row))
  for (field in deps) if (!is.na(row[1L, field])) {
    dependencies <- trimws(gsub("\\s*\\([^)]*\\)", "", strsplit(row[1L, field], ",")[[1L]]))
    pending <- unique(c(pending, dependencies[nzchar(dependencies)]))
  }
  v <- index[index[, "Package"] == name, "Version"]
  stopifnot(length(v) == 1L)
  dest <- file.path("_r-wasm", paste0(name, "_", v, ".tgz"))
  download.file(paste0(repo, basename(dest)), dest, mode = "wb")
  utils::untar(dest, exdir = lib)
  included <- c(included, name)
}
for (pkg in list.dirs(lib, recursive = FALSE)) unlink(file.path(pkg, c("help", "html", "doc", "tests", "demo", "include")), recursive = TRUE)
rwasm::file_packager(normalizePath(lib), normalizePath("_r-wasm-image"), "library.data")
