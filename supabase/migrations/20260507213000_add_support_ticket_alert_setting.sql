begin;

insert into public.app_content_pages (key, title, body)
values (
  'support_ticket_alerts',
  'Support Ticket Alerts',
  'true'
)
on conflict (key) do nothing;

commit;

