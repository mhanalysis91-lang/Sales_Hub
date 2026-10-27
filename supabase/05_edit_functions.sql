-- Sales Hub - 05 edit functions (run once in Supabase SQL Editor, after 01 and 03).
-- Every change takes effect on a date you choose. The old row is closed on that date and a new one opens,
-- so earlier months keep their old mapping. Nothing is deleted except a row that starts on the very same date (a correction).
-- The functions run with the caller's rights, so only the admin can use them (RLS still applies).

begin;

-- Move bricks into a box from a date. p_box_id NULL = take the bricks out of this line from that date.
create or replace function public.move_bricks(p_brick_ids int[], p_line_id int, p_box_id int, p_date date)
returns void language plpgsql set search_path = '' as $$
declare b int; cur record; nxt date;
begin
  if p_date is null then raise exception 'Effective date is required'; end if;
  if p_box_id is not null and not exists (select 1 from public.boxes where id = p_box_id and line_id = p_line_id) then
    raise exception 'That box does not belong to this line';
  end if;
  foreach b in array p_brick_ids loop
    select * into cur from public.brick_box_map where brick_id = b and line_id = p_line_id and valid_from = p_date;
    if found then
      if p_box_id is null then delete from public.brick_box_map where id = cur.id;
      else update public.brick_box_map set box_id = p_box_id where id = cur.id; end if;
      continue;
    end if;
    select * into cur from public.brick_box_map
      where brick_id = b and line_id = p_line_id and valid_from < p_date and (valid_to is null or valid_to > p_date);
    if found then
      if cur.box_id is not distinct from p_box_id then continue; end if;
      update public.brick_box_map set valid_to = p_date where id = cur.id;
      if p_box_id is not null then
        insert into public.brick_box_map (brick_id, line_id, box_id, valid_from, valid_to)
        values (b, p_line_id, p_box_id, p_date, cur.valid_to);
      end if;
    elsif p_box_id is not null then
      select min(valid_from) into nxt from public.brick_box_map where brick_id = b and line_id = p_line_id and valid_from > p_date;
      insert into public.brick_box_map (brick_id, line_id, box_id, valid_from, valid_to)
      values (b, p_line_id, p_box_id, p_date, nxt);
    end if;
  end loop;
end $$;

-- Set the rep and manager of a box from a date.
create or replace function public.change_box_assignment(p_box_id int, p_rep_id int, p_manager_id int, p_date date)
returns void language plpgsql set search_path = '' as $$
declare cur record; nxt date;
begin
  if p_date is null then raise exception 'Effective date is required'; end if;
  if p_rep_id is null then raise exception 'Rep is required'; end if;
  select * into cur from public.box_assignments where box_id = p_box_id and valid_from = p_date;
  if found then
    update public.box_assignments set rep_id = p_rep_id, manager_id = p_manager_id where id = cur.id;
    return;
  end if;
  select * into cur from public.box_assignments
    where box_id = p_box_id and valid_from < p_date and (valid_to is null or valid_to > p_date);
  if found then
    if cur.rep_id = p_rep_id and cur.manager_id is not distinct from p_manager_id then return; end if;
    update public.box_assignments set valid_to = p_date where id = cur.id;
    insert into public.box_assignments (box_id, rep_id, manager_id, valid_from, valid_to)
    values (p_box_id, p_rep_id, p_manager_id, p_date, cur.valid_to);
  else
    select min(valid_from) into nxt from public.box_assignments where box_id = p_box_id and valid_from > p_date;
    insert into public.box_assignments (box_id, rep_id, manager_id, valid_from, valid_to)
    values (p_box_id, p_rep_id, p_manager_id, p_date, nxt);
  end if;
end $$;

-- Add a box with its first rep and manager.
create or replace function public.add_box(p_line_id int, p_district_id int, p_name text, p_box_code text,
                                          p_rep_id int, p_manager_id int, p_date date)
returns int language plpgsql set search_path = '' as $$
declare new_id int;
begin
  insert into public.boxes (line_id, district_id, name, box_code)
  values (p_line_id, p_district_id, p_name, p_box_code) returning id into new_id;
  if p_rep_id is not null then
    perform public.change_box_assignment(new_id, p_rep_id, p_manager_id, p_date);
  end if;
  return new_id;
end $$;

-- Copy the boxes and brick distribution of one line into an empty new line (no reps or managers).
create or replace function public.copy_line_structure(p_src_line int, p_dst_line int, p_date date)
returns int language plpgsql set search_path = '' as $$
declare dst_code text; n int;
begin
  if exists (select 1 from public.boxes where line_id = p_dst_line) then
    raise exception 'The new line already has boxes';
  end if;
  select code into dst_code from public.lines where id = p_dst_line;
  insert into public.boxes (line_id, district_id, name, box_code)
  select p_dst_line, district_id, name, name || ' ' || dst_code from public.boxes where line_id = p_src_line;
  get diagnostics n = row_count;
  insert into public.brick_box_map (brick_id, line_id, box_id, valid_from, valid_to)
  select m.brick_id, p_dst_line, nb.id, p_date, null
  from public.brick_box_map m
  join public.boxes sb on sb.id = m.box_id
  join public.boxes nb on nb.line_id = p_dst_line and nb.name = sb.name
  where m.line_id = p_src_line and m.valid_from <= p_date and (m.valid_to is null or m.valid_to > p_date);
  return n;
end $$;

revoke all on function public.move_bricks(int[], int, int, date) from public, anon;
revoke all on function public.change_box_assignment(int, int, int, date) from public, anon;
revoke all on function public.add_box(int, int, text, text, int, int, date) from public, anon;
revoke all on function public.copy_line_structure(int, int, date) from public, anon;
grant execute on function public.move_bricks(int[], int, int, date) to authenticated;
grant execute on function public.change_box_assignment(int, int, int, date) to authenticated;
grant execute on function public.add_box(int, int, text, text, int, int, date) to authenticated;
grant execute on function public.copy_line_structure(int, int, date) to authenticated;

commit;
