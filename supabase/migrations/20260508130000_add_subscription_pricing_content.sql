begin;

insert into public.app_content_pages (key, title, body)
values (
  'subscription_pricing',
  'Subscription Pricing',
  '{
    "monthly": {
      "title": "Pro Monthly",
      "price": "₹99",
      "period": "/month",
      "subtitle": "Low-commitment plan for users who want monthly flexibility.",
      "originalPrice": "₹129",
      "savings": "Launch offer: save ₹30 every month",
      "billingMeta": "Billed monthly • Cancel anytime"
    },
    "yearly": {
      "title": "Pro Yearly",
      "price": "₹999",
      "period": "/year",
      "subtitle": "Best value plan for regular AI and voice consultation users.",
      "originalPrice": "₹1,200",
      "savings": "Save ₹201/year • Effective ₹83/month",
      "billingMeta": "Billed yearly • Best for long-term savings"
    }
  }'
)
on conflict (key) do nothing;

commit;

