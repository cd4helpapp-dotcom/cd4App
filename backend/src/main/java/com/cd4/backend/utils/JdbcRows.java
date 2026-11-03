package com.cd4.backend.utils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Rows for simple read endpoints, with keys in the same camelCase as every other API response. */
@Component
@RequiredArgsConstructor
public class JdbcRows {
    private static final Pattern SNAKE = Pattern.compile("_([a-z0-9])");

    private final JdbcTemplate jdbc;

    public List<Map<String, Object>> query(String sql, Object... args) {
        return jdbc.queryForList(sql, args).stream().map(JdbcRows::camel).toList();
    }

    private static Map<String, Object> camel(Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>();
        row.forEach((key, value) -> out.put(SNAKE.matcher(key).replaceAll(m -> m.group(1).toUpperCase()), value));
        return out;
    }
}
