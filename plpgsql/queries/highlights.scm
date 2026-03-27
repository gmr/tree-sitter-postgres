; highlights.scm — tree-sitter-plpgsql syntax highlighting queries
;
; Note: SQL expressions are opaque (captured by external scanner).
; Only PL/pgSQL structural tokens are highlighted here. SQL fragments
; get their highlighting via language injection into the postgres grammar.

; ── Comments ──────────────────────────────────────────────────────────────────

(comment) @comment

; ── Literals ──────────────────────────────────────────────────────────────────

(integer_literal) @number
(string_literal) @string

(kw_null) @constant.builtin

; ── Identifiers ───────────────────────────────────────────────────────────────

(identifier) @variable

; ── Labels ────────────────────────────────────────────────────────────────────

(block_label (identifier) @label)
(loop_label (identifier) @label)
(end_label) @label

; ── Operators ─────────────────────────────────────────────────────────────────

[":=" "=" ".."] @operator

; ── Punctuation ───────────────────────────────────────────────────────────────

["(" ")"] @punctuation.bracket
["[" "]"] @punctuation.bracket
["<<" ">>"] @punctuation.bracket
"," @punctuation.delimiter
"." @punctuation.delimiter
";" @punctuation.delimiter

; ── Block structure keywords ──────────────────────────────────────────────────

[
  (kw_begin)
  (kw_end)
  (kw_declare)
] @keyword

; ── Control flow keywords ────────────────────────────────────────────────────

[
  (kw_if)
  (kw_then)
  (kw_elsif)
  (kw_else)
  (kw_case)
  (kw_when)
] @keyword

; ── Loop keywords ────────────────────────────────────────────────────────────

[
  (kw_loop)
  (kw_while)
  (kw_for)
  (kw_foreach)
  (kw_in)
  (kw_reverse)
  (kw_by)
  (kw_slice)
  (kw_array)
  (kw_exit)
  (kw_continue)
] @keyword

; ── Statement keywords ───────────────────────────────────────────────────────

[
  (kw_return)
  (kw_perform)
  (kw_execute)
  (kw_call)
  (kw_do)
  (kw_raise)
  (kw_assert)
  (kw_get)
  (kw_diagnostics)
  (kw_open)
  (kw_fetch)
  (kw_move)
  (kw_close)
  (kw_into)
  (kw_using)
  (kw_strict)
  (kw_next)
  (kw_query)
  (kw_from)
] @keyword

; ── Declaration keywords ─────────────────────────────────────────────────────

[
  (kw_constant)
  (kw_alias)
  (kw_cursor)
  (kw_scroll)
  (kw_no)
  (kw_is)
  (kw_not)
  (kw_default)
  (kw_collate)
  (kw_type)
  (kw_rowtype)
] @keyword

; ── Exception keywords ───────────────────────────────────────────────────────

[
  (kw_exception)
  (kw_or)
  (kw_sqlstate)
] @keyword

; ── Transaction keywords ─────────────────────────────────────────────────────

[
  (kw_commit)
  (kw_rollback)
  (kw_chain)
  (kw_and)
] @keyword

; ── RAISE level keywords ─────────────────────────────────────────────────────

(raise_level) @keyword

; ── RAISE option keywords ────────────────────────────────────────────────────

(raise_option
  [
    (kw_message)
    (kw_detail)
    (kw_hint)
    (kw_errcode)
  ] @keyword)

; ── GET DIAGNOSTICS items ────────────────────────────────────────────────────

(getdiag_item) @keyword

; ── Fetch direction keywords ─────────────────────────────────────────────────

(fetch_direction) @keyword
