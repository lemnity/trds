import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // «Текст» новости: обычный текст → визуальный редактор (Lexical JSON). Прежний текст, если он
  // есть, становится абзацами (разделитель — пустая строка), пустой — NULL.
  await db.execute(sql`
  CREATE FUNCTION pg_temp.news_text_to_lexical(t text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN t IS NULL OR btrim(t) = '' THEN NULL ELSE jsonb_build_object('root',
      jsonb_build_object('type', 'root', 'format', '', 'indent', 0, 'version', 1, 'direction', 'ltr',
        'children', (
          SELECT jsonb_agg(jsonb_build_object('type', 'paragraph', 'format', '', 'indent', 0,
            'version', 1, 'direction', 'ltr', 'textFormat', 0, 'textStyle', '',
            'children', jsonb_build_array(jsonb_build_object('type', 'text', 'text', btrim(p),
              'format', 0, 'style', '', 'mode', 'normal', 'detail', 0, 'version', 1))))
          FROM regexp_split_to_table(t, E'\\n\\s*\\n') AS p WHERE btrim(p) <> ''
        ))) END
  $$;
  ALTER TABLE "news" ALTER COLUMN "body" SET DATA TYPE jsonb
    USING pg_temp.news_text_to_lexical("body");
  ALTER TABLE "_news_v" ALTER COLUMN "version_body" SET DATA TYPE jsonb
    USING pg_temp.news_text_to_lexical("version_body");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "news" ALTER COLUMN "body" SET DATA TYPE varchar USING "body"::text;
  ALTER TABLE "_news_v" ALTER COLUMN "version_body" SET DATA TYPE varchar USING "version_body"::text;`)
}
