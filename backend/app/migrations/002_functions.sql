-- norm(text): lower-case with punctuation removed, so 'A-101', 'a 101' and 'A101' style text compare sensibly.
CREATE OR REPLACE FUNCTION norm(t text) RETURNS text AS $$
    SELECT trim(regexp_replace(lower(coalesce(t, '')), '[^[:alnum:]]+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;
