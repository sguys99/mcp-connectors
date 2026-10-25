-- NL2SQL 샘플 DB: Pagila 테이블/컬럼 코멘트와 초기화 마무리
--
-- Pagila 원본에는 코멘트가 없어 스키마 도구(search_tables_schema, get_table_schema 등)가
-- 설명 없이 이름만 돌려줍니다. LLM 이 테이블과 컬럼 뜻을 알 수 있도록 영어 설명을 붙여요.
-- 내용은 Mock 백엔드 픽스처(src/mcp-servers/nl2sql_mcp/db/mock_backend.py)와 같아야 하며,
-- tests/nl2sql_mcp/test_sample_db_files.py 가 둘이 어긋나지 않는지 확인합니다.
-- "(PII)" 표시는 설명용이고, 실제 차단 기준은 서버의 PII 설정입니다.

\set ON_ERROR_STOP on

-- actor
COMMENT ON TABLE public.actor IS 'Actor';
COMMENT ON COLUMN public.actor.actor_id IS 'PK';
COMMENT ON COLUMN public.actor.first_name IS 'First name (PII)';
COMMENT ON COLUMN public.actor.last_name IS 'Last name (PII)';
COMMENT ON COLUMN public.actor.last_update IS 'Last modified at';

-- address
COMMENT ON TABLE public.address IS 'Address';
COMMENT ON COLUMN public.address.address_id IS 'PK';
COMMENT ON COLUMN public.address.address IS 'Street address (PII)';
COMMENT ON COLUMN public.address.address2 IS 'Address line 2';
COMMENT ON COLUMN public.address.district IS 'District';
COMMENT ON COLUMN public.address.city_id IS 'FK→city';
COMMENT ON COLUMN public.address.postal_code IS 'Postal code';
COMMENT ON COLUMN public.address.phone IS 'Phone number (PII)';
COMMENT ON COLUMN public.address.last_update IS 'Last modified at';

-- category
COMMENT ON TABLE public.category IS 'Film category';
COMMENT ON COLUMN public.category.category_id IS 'PK';
COMMENT ON COLUMN public.category.name IS 'Category name';
COMMENT ON COLUMN public.category.last_update IS 'Last modified at';

-- city
COMMENT ON TABLE public.city IS 'City';
COMMENT ON COLUMN public.city.city_id IS 'PK';
COMMENT ON COLUMN public.city.city IS 'City name';
COMMENT ON COLUMN public.city.country_id IS 'FK→country';
COMMENT ON COLUMN public.city.last_update IS 'Last modified at';

-- country
COMMENT ON TABLE public.country IS 'Country';
COMMENT ON COLUMN public.country.country_id IS 'PK';
COMMENT ON COLUMN public.country.country IS 'Country name';
COMMENT ON COLUMN public.country.last_update IS 'Last modified at';

-- customer
COMMENT ON TABLE public.customer IS 'Customer master data';
COMMENT ON COLUMN public.customer.customer_id IS 'PK';
COMMENT ON COLUMN public.customer.store_id IS 'FK→store';
COMMENT ON COLUMN public.customer.first_name IS 'First name (PII)';
COMMENT ON COLUMN public.customer.last_name IS 'Last name (PII)';
COMMENT ON COLUMN public.customer.email IS 'Email (PII)';
COMMENT ON COLUMN public.customer.address_id IS 'FK→address';
COMMENT ON COLUMN public.customer.activebool IS 'Active flag (boolean)';
COMMENT ON COLUMN public.customer.create_date IS 'Sign-up date';
COMMENT ON COLUMN public.customer.last_update IS 'Last modified at';
COMMENT ON COLUMN public.customer.active IS 'Active flag (1/0)';

-- film
COMMENT ON TABLE public.film IS 'Film master';
COMMENT ON COLUMN public.film.film_id IS 'PK';
COMMENT ON COLUMN public.film.title IS 'Title';
COMMENT ON COLUMN public.film.description IS 'Synopsis';
COMMENT ON COLUMN public.film.release_year IS 'Release year (domain year, 1901 to 2155)';
COMMENT ON COLUMN public.film.language_id IS 'FK→language';
COMMENT ON COLUMN public.film.original_language_id IS 'FK→language (original language)';
COMMENT ON COLUMN public.film.rental_duration IS 'Rental duration (days)';
COMMENT ON COLUMN public.film.rental_rate IS 'Rental rate';
COMMENT ON COLUMN public.film.length IS 'Running time (minutes)';
COMMENT ON COLUMN public.film.replacement_cost IS 'Replacement cost';
COMMENT ON COLUMN public.film.rating IS 'MPAA rating (G/PG/PG-13/R/NC-17)';
COMMENT ON COLUMN public.film.last_update IS 'Last modified at';
COMMENT ON COLUMN public.film.special_features IS 'Special features';
COMMENT ON COLUMN public.film.fulltext IS 'Full-text search vector';

-- film_actor
COMMENT ON TABLE public.film_actor IS 'Film to actor link';
COMMENT ON COLUMN public.film_actor.actor_id IS 'PK, FK→actor';
COMMENT ON COLUMN public.film_actor.film_id IS 'PK, FK→film';
COMMENT ON COLUMN public.film_actor.last_update IS 'Last modified at';

-- film_category
COMMENT ON TABLE public.film_category IS 'Film to category link';
COMMENT ON COLUMN public.film_category.film_id IS 'PK, FK→film';
COMMENT ON COLUMN public.film_category.category_id IS 'PK, FK→category';
COMMENT ON COLUMN public.film_category.last_update IS 'Last modified at';

-- inventory
COMMENT ON TABLE public.inventory IS 'Film inventory per store';
COMMENT ON COLUMN public.inventory.inventory_id IS 'PK';
COMMENT ON COLUMN public.inventory.film_id IS 'FK→film';
COMMENT ON COLUMN public.inventory.store_id IS 'FK→store';
COMMENT ON COLUMN public.inventory.last_update IS 'Last modified at';

-- language
COMMENT ON TABLE public.language IS 'Language';
COMMENT ON COLUMN public.language.language_id IS 'PK';
COMMENT ON COLUMN public.language.name IS 'Language name';
COMMENT ON COLUMN public.language.last_update IS 'Last modified at';

-- payment
COMMENT ON TABLE public.payment IS 'Payments (partitioned by month on payment_date)';
COMMENT ON COLUMN public.payment.payment_id IS 'PK';
COMMENT ON COLUMN public.payment.customer_id IS 'FK→customer';
COMMENT ON COLUMN public.payment.staff_id IS 'FK→staff';
COMMENT ON COLUMN public.payment.rental_id IS 'FK→rental';
COMMENT ON COLUMN public.payment.amount IS 'Payment amount';
COMMENT ON COLUMN public.payment.payment_date IS 'Payment timestamp';

-- rental
COMMENT ON TABLE public.rental IS 'Rentals';
COMMENT ON COLUMN public.rental.rental_id IS 'PK';
COMMENT ON COLUMN public.rental.rental_date IS 'Rental timestamp';
COMMENT ON COLUMN public.rental.inventory_id IS 'FK→inventory';
COMMENT ON COLUMN public.rental.customer_id IS 'FK→customer';
COMMENT ON COLUMN public.rental.return_date IS 'Return timestamp (NULL means not returned)';
COMMENT ON COLUMN public.rental.staff_id IS 'FK→staff';
COMMENT ON COLUMN public.rental.last_update IS 'Last modified at';

-- staff
COMMENT ON TABLE public.staff IS 'Staff';
COMMENT ON COLUMN public.staff.staff_id IS 'PK';
COMMENT ON COLUMN public.staff.first_name IS 'First name (PII)';
COMMENT ON COLUMN public.staff.last_name IS 'Last name (PII)';
COMMENT ON COLUMN public.staff.address_id IS 'FK→address';
COMMENT ON COLUMN public.staff.email IS 'Email (PII)';
COMMENT ON COLUMN public.staff.store_id IS 'FK→store';
COMMENT ON COLUMN public.staff.active IS 'Active employee flag';
COMMENT ON COLUMN public.staff.username IS 'Login username';
COMMENT ON COLUMN public.staff.password IS 'Password hash (PII)';
COMMENT ON COLUMN public.staff.last_update IS 'Last modified at';
COMMENT ON COLUMN public.staff.picture IS 'Photo';

-- store
COMMENT ON TABLE public.store IS 'Store';
COMMENT ON COLUMN public.store.store_id IS 'PK';
COMMENT ON COLUMN public.store.manager_staff_id IS 'FK→staff (store manager)';
COMMENT ON COLUMN public.store.address_id IS 'FK→address';
COMMENT ON COLUMN public.store.last_update IS 'Last modified at';

-- actor_info
COMMENT ON VIEW public.actor_info IS 'View: film summary per actor';
COMMENT ON COLUMN public.actor_info.actor_id IS 'Actor ID';
COMMENT ON COLUMN public.actor_info.first_name IS 'First name (PII)';
COMMENT ON COLUMN public.actor_info.last_name IS 'Last name (PII)';
COMMENT ON COLUMN public.actor_info.film_info IS 'Films by category';

-- customer_list
COMMENT ON VIEW public.customer_list IS 'View: customer list (joined with address)';
COMMENT ON COLUMN public.customer_list.id IS 'Customer ID';
COMMENT ON COLUMN public.customer_list.name IS 'Full name (PII)';
COMMENT ON COLUMN public.customer_list.address IS 'Street address (PII)';
COMMENT ON COLUMN public.customer_list."zip code" IS 'Postal code';
COMMENT ON COLUMN public.customer_list.phone IS 'Phone number (PII)';
COMMENT ON COLUMN public.customer_list.city IS 'City';
COMMENT ON COLUMN public.customer_list.country IS 'Country';
COMMENT ON COLUMN public.customer_list.notes IS 'Active status label';
COMMENT ON COLUMN public.customer_list.sid IS 'Store ID';

-- film_list
COMMENT ON VIEW public.film_list IS 'View: film list (joined with category and actors)';
COMMENT ON COLUMN public.film_list.fid IS 'Film ID';
COMMENT ON COLUMN public.film_list.title IS 'Title';
COMMENT ON COLUMN public.film_list.description IS 'Synopsis';
COMMENT ON COLUMN public.film_list.category IS 'Category name';
COMMENT ON COLUMN public.film_list.price IS 'Rental rate';
COMMENT ON COLUMN public.film_list.length IS 'Running time (minutes)';
COMMENT ON COLUMN public.film_list.rating IS 'Rating';
COMMENT ON COLUMN public.film_list.actors IS 'Cast list';

-- nicer_but_slower_film_list
COMMENT ON VIEW public.nicer_but_slower_film_list IS 'View: film list (tidier formatting, slower)';
COMMENT ON COLUMN public.nicer_but_slower_film_list.fid IS 'Film ID';
COMMENT ON COLUMN public.nicer_but_slower_film_list.title IS 'Title';
COMMENT ON COLUMN public.nicer_but_slower_film_list.description IS 'Synopsis';
COMMENT ON COLUMN public.nicer_but_slower_film_list.category IS 'Category name';
COMMENT ON COLUMN public.nicer_but_slower_film_list.price IS 'Rental rate';
COMMENT ON COLUMN public.nicer_but_slower_film_list.length IS 'Running time (minutes)';
COMMENT ON COLUMN public.nicer_but_slower_film_list.rating IS 'Rating';
COMMENT ON COLUMN public.nicer_but_slower_film_list.actors IS 'Cast list';

-- rental_by_category
COMMENT ON MATERIALIZED VIEW public.rental_by_category IS 'Materialized view: total sales per category (refreshed at init)';
COMMENT ON COLUMN public.rental_by_category.category IS 'Category name';
COMMENT ON COLUMN public.rental_by_category.total_sales IS 'Total sales';

-- sales_by_film_category
COMMENT ON VIEW public.sales_by_film_category IS 'View: total sales per category';
COMMENT ON COLUMN public.sales_by_film_category.category IS 'Category name';
COMMENT ON COLUMN public.sales_by_film_category.total_sales IS 'Total sales';

-- sales_by_store
COMMENT ON VIEW public.sales_by_store IS 'View: total sales per store';
COMMENT ON COLUMN public.sales_by_store.store IS 'Store location (city, country)';
COMMENT ON COLUMN public.sales_by_store.manager IS 'Manager full name (PII)';
COMMENT ON COLUMN public.sales_by_store.total_sales IS 'Total sales';

-- staff_list
COMMENT ON VIEW public.staff_list IS 'View: staff list (joined with address)';
COMMENT ON COLUMN public.staff_list.id IS 'Staff ID';
COMMENT ON COLUMN public.staff_list.name IS 'Full name (PII)';
COMMENT ON COLUMN public.staff_list.address IS 'Street address (PII)';
COMMENT ON COLUMN public.staff_list."zip code" IS 'Postal code';
COMMENT ON COLUMN public.staff_list.phone IS 'Phone number (PII)';
COMMENT ON COLUMN public.staff_list.city IS 'City';
COMMENT ON COLUMN public.staff_list.country IS 'Country';
COMMENT ON COLUMN public.staff_list.sid IS 'Store ID';

-- 구체화 뷰는 upstream 이 WITH NO DATA 로 만들어 그대로 조회하면 오류가 납니다
REFRESH MATERIALIZED VIEW public.rental_by_category;

-- 통계 수집: 카탈로그의 estimated_rows(pg_class.reltuples)가 -1 이 아닌 실제 행 수가 되도록
ANALYZE;
