begin;

select set_config(
  'request.jwt.claim.sub',
  'ccc150c6-cff6-474a-86f8-c0bbdeb762e4',
  true
);

select public.add_artist_to_archive('Midori Harada') as added_artist_id;

select *
from public.user_tracked_artists
where user_id = 'ccc150c6-cff6-474a-86f8-c0bbdeb762e4'::uuid
order by added_at desc
limit 5;

rollback;
