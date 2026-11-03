alter table employee_brands
  add column if not exists is_primary boolean not null default false;
