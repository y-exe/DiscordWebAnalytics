-- PostgreSQL-level counters. temp_bytes is cumulative since statistics were reset.
SELECT datname, numbackends, temp_files, pg_size_pretty(temp_bytes) AS temp_written, stats_reset
FROM pg_stat_database
WHERE datname = current_database();

-- Requires pg_stat_statements to be preloaded and created in this database.
-- ORDER BY temp_blks_written to find SQL that spills to temporary files.
SELECT queryid,
       calls,
       round(total_exec_time::numeric, 1) AS total_exec_ms,
       round(mean_exec_time::numeric, 1) AS mean_exec_ms,
       rows,
       temp_blks_written,
       shared_blks_read,
       left(query, 300) AS query
FROM pg_stat_statements
ORDER BY temp_blks_written DESC, total_exec_time DESC
LIMIT 20;

-- Relation and index footprint for the message fact table.
SELECT c.relname,
       c.reltuples::bigint AS estimated_rows,
       pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
       pg_size_pretty(pg_indexes_size(c.oid)) AS indexes_size,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'messages';
