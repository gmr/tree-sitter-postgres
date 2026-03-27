; highlights.scm — tree-sitter-postgres syntax highlighting queries

; ── Comments ──────────────────────────────────────────────────────────────────

(comment) @comment

; ── Literals ──────────────────────────────────────────────────────────────────

(integer_literal) @number
(float_literal) @number.float
(string_literal) @string
(bit_string_literal) @string
(hex_string_literal) @string

(kw_true) @boolean
(kw_false) @boolean
(kw_null) @constant.builtin

(param) @variable.parameter

; ── Identifiers ───────────────────────────────────────────────────────────────

(identifier) @variable

(columnref
  (ColId) @variable)

; ── Types ─────────────────────────────────────────────────────────────────────

(Typename
  (SimpleTypename) @type.builtin)

(GenericType
  (type_function_name) @type)

; ── Functions ─────────────────────────────────────────────────────────────────

(func_application
  (func_name) @function.call)

(func_expr_common_subexpr) @function.call

; ── Operators ─────────────────────────────────────────────────────────────────

(operator) @operator

[
  "+"
  "-"
  "*"
  "/"
  "%"
  "^"
  "<"
  ">"
  "="
] @operator

; ── Punctuation ───────────────────────────────────────────────────────────────

["(" ")"] @punctuation.bracket
["[" "]"] @punctuation.bracket
"," @punctuation.delimiter
"." @punctuation.delimiter
";" @punctuation.delimiter

; ── Statement keywords ────────────────────────────────────────────────────────

[
  (kw_select)
  (kw_from)
  (kw_where)
  (kw_insert)
  (kw_into)
  (kw_update)
  (kw_delete)
  (kw_create)
  (kw_alter)
  (kw_drop)
  (kw_table)
  (kw_index)
  (kw_view)
  (kw_with)
  (kw_as)
  (kw_set)
  (kw_values)
  (kw_returning)
  (kw_explain)
  (kw_analyze)
  (kw_vacuum)
  (kw_truncate)
  (kw_copy)
  (kw_grant)
  (kw_revoke)
] @keyword

; ── Clause keywords ───────────────────────────────────────────────────────────

[
  (kw_distinct)
  (kw_all)
  (kw_group)
  (kw_order)
  (kw_by)
  (kw_having)
  (kw_limit)
  (kw_offset)
  (kw_fetch)
  (kw_for)
  (kw_on)
  (kw_using)
  (kw_asc)
  (kw_desc)
  (kw_nulls)
  (kw_first)
  (kw_last)
  (kw_only)
  (kw_recursive)
  (kw_cascade)
  (kw_restrict)
  (kw_if)
  (kw_exists)
] @keyword

; ── Join keywords ─────────────────────────────────────────────────────────────

[
  (kw_join)
  (kw_inner)
  (kw_left)
  (kw_right)
  (kw_full)
  (kw_cross)
  (kw_natural)
  (kw_lateral)
] @keyword

; ── Logical / boolean keywords ────────────────────────────────────────────────

[
  (kw_and)
  (kw_or)
  (kw_not)
  (kw_in)
  (kw_between)
  (kw_like)
  (kw_ilike)
  (kw_similar)
  (kw_is)
  (kw_isnull)
  (kw_notnull)
  (kw_escape)
] @keyword.operator

; ── Set operation keywords ────────────────────────────────────────────────────

[
  (kw_union)
  (kw_intersect)
  (kw_except)
] @keyword

; ── Conditional keywords ──────────────────────────────────────────────────────

[
  (kw_case)
  (kw_when)
  (kw_then)
  (kw_else)
  (kw_end)
] @keyword

; ── Transaction keywords ──────────────────────────────────────────────────────

[
  (kw_begin)
  (kw_commit)
  (kw_rollback)
  (kw_savepoint)
  (kw_release)
  (kw_abort)
  (kw_start)
] @keyword

; ── Type keywords ─────────────────────────────────────────────────────────────

[
  (kw_int)
  (kw_integer)
  (kw_smallint)
  (kw_bigint)
  (kw_decimal)
  (kw_numeric)
  (kw_float)
  (kw_real)
  (kw_double)
  (kw_char)
  (kw_character)
  (kw_varchar)
  (kw_text)
  (kw_boolean)
  (kw_bit)
  (kw_time)
  (kw_timestamp)
  (kw_interval)
  (kw_array)
  (kw_json)
  (kw_xml)
] @type.builtin

; ── Constraint / DDL keywords ─────────────────────────────────────────────────

[
  (kw_primary)
  (kw_key)
  (kw_unique)
  (kw_check)
  (kw_foreign)
  (kw_references)
  (kw_constraint)
  (kw_default)
  (kw_collate)
  (kw_not)
] @keyword

; ── Aggregate / window keywords ───────────────────────────────────────────────

[
  (kw_over)
  (kw_partition)
  (kw_rows)
  (kw_range)
  (kw_groups)
  (kw_preceding)
  (kw_following)
  (kw_unbounded)
  (kw_current)
] @keyword

; ── Other common keywords (catch-all) ─────────────────────────────────────────

[
  (kw_to)
  (kw_of)
  (kw_cast)
  (kw_do)
  (kw_function)
  (kw_procedure)
  (kw_trigger)
  (kw_temporary)
  (kw_temp)
  (kw_unlogged)
  (kw_materialized)
  (kw_schema)
  (kw_database)
  (kw_extension)
  (kw_sequence)
  (kw_domain)
  (kw_type)
  (kw_role)
  (kw_user)
  (kw_owner)
  (kw_language)
  (kw_replace)
  (kw_returns)
  (kw_security)
  (kw_row)
  (kw_column)
  (kw_add)
  (kw_rename)
  (kw_no)
  (kw_cycle)
  (kw_increment)
  (kw_maxvalue)
  (kw_minvalue)
  (kw_cache)
  (kw_owned)
  (kw_local)
  (kw_global)
  (kw_execute)
  (kw_prepare)
  (kw_deallocate)
  (kw_listen)
  (kw_notify)
  (kw_load)
  (kw_lock)
  (kw_move)
  (kw_cluster)
  (kw_reindex)
  (kw_reset)
  (kw_show)
  (kw_enable)
  (kw_disable)
  (kw_refresh)
  (kw_concurrently)
  (kw_import)
  (kw_policy)
  (kw_publication)
  (kw_subscription)
] @keyword
