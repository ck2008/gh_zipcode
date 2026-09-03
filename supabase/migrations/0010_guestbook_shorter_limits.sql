-- Tighten the guestbook length caps to 10 / 100 characters.
--
-- length() counts characters, not bytes, so the cap is 10 characters whether
-- they are Chinese or Latin -- a 10-character nickname budget is generous in
-- Chinese and tight in Latin script.  index.html carries matching maxlength
-- attributes; this check is the one that actually enforces, since the browser
-- attribute is trivially bypassed.
create or replace function public.guestbook_post_comment(
  p_token uuid, p_answer text, p_author text, p_body text
) returns text
language plpgsql volatile security definer set search_path = guestbook, pg_temp as $$
declare
  v_answer text;
begin
  if not guestbook.take_token('post', 10) then
    return 'rate_limited';
  end if;
  if coalesce(btrim(p_author), '') = '' or coalesce(btrim(p_body), '') = '' then
    return 'empty';
  end if;
  if length(btrim(p_author)) > 10 or length(btrim(p_body)) > 100 then
    return 'too_long';
  end if;
  update guestbook.captcha set consumed_at = now()
  where token = p_token and consumed_at is null and expires_at > now()
  returning answer into v_answer;
  if v_answer is null then
    return 'captcha_expired';
  end if;
  if upper(btrim(p_answer)) <> v_answer then
    return 'captcha_wrong';
  end if;
  insert into guestbook.comment (author, body) values (btrim(p_author), btrim(p_body));
  return 'pending';
end;
$$;
notify pgrst, 'reload schema';
