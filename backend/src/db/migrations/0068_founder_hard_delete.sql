-- Permanent Founder deletion.
--
-- This is deliberately exposed through one narrowly-scoped SECURITY DEFINER
-- function rather than broad DELETE grants. The function can only start from a
-- Founder UUID, verifies the email confirmation under a row lock, and removes
-- foreign-key descendants before their parents in the same transaction.

CREATE OR REPLACE FUNCTION proovd_delete_record_tree(
  p_parent regclass,
  p_where text,
  p_depth integer DEFAULT 0
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  fk record;
  child_where text;
  child_exists boolean;
  deleted_here bigint := 0;
  deleted_below bigint := 0;
BEGIN
  IF p_depth > 64 THEN
    RAISE EXCEPTION 'Founder deletion dependency graph exceeded its safe depth'
      USING ERRCODE = '54001';
  END IF;

  FOR fk IN
    SELECT
      c.conrelid::regclass AS child_table,
      string_agg(
        format('t.%I IS NOT DISTINCT FROM p.%I', child_att.attname, parent_att.attname),
        ' AND ' ORDER BY keys.ord
      ) AS join_sql
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey, c.confkey)
      WITH ORDINALITY AS keys(child_attnum, parent_attnum, ord)
    JOIN pg_attribute child_att
      ON child_att.attrelid = c.conrelid
     AND child_att.attnum = keys.child_attnum
    JOIN pg_attribute parent_att
      ON parent_att.attrelid = c.confrelid
     AND parent_att.attnum = keys.parent_attnum
    WHERE c.contype = 'f'
      AND c.confrelid = p_parent
    GROUP BY c.oid, c.conrelid
    ORDER BY c.oid
  LOOP
    child_where := format(
      'EXISTS (SELECT 1 FROM (SELECT * FROM %s t WHERE %s) p WHERE %s)',
      p_parent,
      p_where,
      fk.join_sql
    );

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %s t WHERE %s)',
      fk.child_table,
      child_where
    ) INTO child_exists;

    IF child_exists THEN
      deleted_below := deleted_below + proovd_delete_record_tree(
        fk.child_table,
        child_where,
        p_depth + 1
      );
    END IF;
  END LOOP;

  EXECUTE format('DELETE FROM %s t WHERE %s', p_parent, p_where);
  GET DIAGNOSTICS deleted_here = ROW_COUNT;
  RETURN deleted_below + deleted_here;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION proovd_delete_record_tree(regclass, text, integer) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION hard_delete_founder(
  p_prospect_id uuid,
  p_confirmation_email text,
  p_reason text,
  p_actor text
) RETURNS TABLE (
  legal_name text,
  email text,
  campaign_count integer,
  deleted_account boolean,
  deleted_rows bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  founder_row record;
  campaign_ids uuid[];
  draft_ids uuid[];
  current_campaign_id uuid;
  v_claimed_user_id text;
  related_ids text[];
  removed bigint := 0;
  removed_user bigint := 0;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'A deletion reason is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT fp.legal_name, fp.email, fp.claimed_user_id
    INTO founder_row
  FROM founder_prospects fp
  WHERE fp.id = p_prospect_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Founder not found' USING ERRCODE = 'P0002';
  END IF;

  IF founder_row.email IS NULL
     OR lower(trim(founder_row.email)) <> lower(trim(coalesce(p_confirmation_email, ''))) THEN
    RAISE EXCEPTION 'Type the Founder email exactly to confirm permanent deletion'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    coalesce(array_agg(cd.id), ARRAY[]::uuid[]),
    coalesce(array_agg(cd.campaign_id), ARRAY[]::uuid[])
    INTO draft_ids, campaign_ids
  FROM campaign_drafts cd
  WHERE cd.prospect_id = p_prospect_id;

  v_claimed_user_id := founder_row.claimed_user_id;
  related_ids := ARRAY[p_prospect_id::text]
    || ARRAY(SELECT value::text FROM unnest(draft_ids) value)
    || ARRAY(SELECT value::text FROM unnest(campaign_ids) value)
    || CASE WHEN v_claimed_user_id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[v_claimed_user_id] END;

  -- These tables intentionally have no foreign keys because they are generic
  -- infrastructure ledgers. Remove rows explicitly before deleting the graph.
  DELETE FROM secure_tokens
  WHERE campaign_draft_id = ANY(draft_ids)
     OR campaign_id = ANY(campaign_ids);
  GET DIAGNOSTICS removed_user = ROW_COUNT;
  removed := removed + removed_user;

  DELETE FROM notification_deliveries
  WHERE entity_id = ANY(related_ids)
     OR lower(target) = lower(founder_row.email);
  GET DIAGNOSTICS removed_user = ROW_COUNT;
  removed := removed + removed_user;

  DELETE FROM audit_events
  WHERE target_id = ANY(related_ids)
     OR (v_claimed_user_id IS NOT NULL AND actor = 'user:' || v_claimed_user_id);
  GET DIAGNOSTICS removed_user = ROW_COUNT;
  removed := removed + removed_user;

  DELETE FROM verification
  WHERE lower(identifier) = lower(founder_row.email);
  GET DIAGNOSTICS removed_user = ROW_COUNT;
  removed := removed + removed_user;

  FOREACH current_campaign_id IN ARRAY campaign_ids LOOP
    removed := removed + proovd_delete_record_tree(
      'campaigns'::regclass,
      format('t.id = %L::uuid', current_campaign_id),
      0
    );
  END LOOP;

  removed := removed + proovd_delete_record_tree(
    'founder_prospects'::regclass,
    format('t.id = %L::uuid', p_prospect_id),
    0
  );

  IF v_claimed_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM "user" u WHERE u.id = v_claimed_user_id AND u.role = 'founder')
     AND NOT EXISTS (SELECT 1 FROM founder_prospects fp WHERE fp.claimed_user_id = v_claimed_user_id) THEN
    removed_user := proovd_delete_record_tree(
      '"user"'::regclass,
      format('t.id = %L', v_claimed_user_id),
      0
    );
    removed := removed + removed_user;
  ELSE
    removed_user := 0;
  END IF;

  -- Keep proof that an Admin used the destructive control without retaining
  -- the deleted Founder UUID, email, name, or account id.
  INSERT INTO audit_events (
    actor,
    target_type,
    target_id,
    action,
    internal_reason,
    new_value
  ) VALUES (
    coalesce(nullif(trim(p_actor), ''), 'system:admin'),
    'founder_record',
    'permanently_deleted',
    'founder.hard_deleted',
    trim(p_reason),
    jsonb_build_object('deleted_rows', removed)
  );

  RETURN QUERY SELECT
    founder_row.legal_name::text,
    founder_row.email::text,
    cardinality(campaign_ids),
    removed_user > 0,
    removed;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION hard_delete_founder(uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION hard_delete_founder(uuid, text, text, text) TO proovd_app;
