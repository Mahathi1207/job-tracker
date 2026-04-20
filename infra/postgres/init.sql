-- ============================================================
-- Job Tracker — PostgreSQL initialisation
-- Runs once when the postgres container is first created.
-- SQLAlchemy create_all() in each service is idempotent
-- (CREATE TABLE IF NOT EXISTS) so there is no conflict.
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users table (owned by auth-service) ──────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR     UNIQUE NOT NULL,
    hashed_password VARCHAR   NOT NULL,
    full_name     VARCHAR,
    is_active     BOOLEAN     DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Jobs table (owned by job-service) ────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL,
    company         VARCHAR     NOT NULL,
    role            VARCHAR     NOT NULL,
    status          VARCHAR     NOT NULL DEFAULT 'applied',
    job_description TEXT,
    notes           TEXT,
    applied_date    DATE        DEFAULT CURRENT_DATE,
    deadline        DATE,
    salary_min      INTEGER,
    salary_max      INTEGER,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs (status);

-- ── Resumes table (owned by job-service) ─────────────────────
CREATE TABLE IF NOT EXISTS resumes (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID        NOT NULL,
    name       VARCHAR(100) NOT NULL,
    keywords   TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes (user_id);

-- resume_id links a job application to the resume used for it
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL;

-- ── Notification logs table (owned by notification-service) ──
CREATE TABLE IF NOT EXISTS notification_logs (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           VARCHAR     NOT NULL,
    job_id            VARCHAR,
    notification_type VARCHAR     NOT NULL,
    recipient_email   VARCHAR,
    sent_at           TIMESTAMPTZ DEFAULT NOW(),
    status            VARCHAR     DEFAULT 'sent'
);

-- ============================================================
-- SEED DATA
-- Demo user UUID matches the one hardcoded in auth-service
-- startup code.  Password is set by auth-service on first boot
-- (it uses passlib bcrypt, not SQL).  We insert a placeholder
-- so that the FK-free job rows have a consistent owner UUID.
-- ============================================================

-- Demo user (password set at runtime by auth-service)
INSERT INTO users (id, email, hashed_password, full_name, is_active)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'demo@jobtracker.com',
    'PLACEHOLDER_OVERWRITTEN_BY_AUTH_SERVICE',
    'Demo User',
    TRUE
) ON CONFLICT (email) DO NOTHING;

-- ── 50 realistic job seed rows ────────────────────────────────
-- Spread across all four statuses, various dates, companies, roles

INSERT INTO jobs (id, user_id, company, role, status, job_description, applied_date, deadline, salary_min, salary_max) VALUES
('11111111-0001-4000-8000-000000000001','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Google','Senior Software Engineer','interviewing','Design and build scalable backend systems for Google Search infrastructure.','2026-03-01',NULL,160000,220000),
('11111111-0002-4000-8000-000000000002','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Amazon','Software Development Engineer II','applied','Work on AWS Lambda service team building serverless compute platforms.','2026-03-05','2026-04-30',130000,180000),
('11111111-0003-4000-8000-000000000003','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Meta','Full Stack Engineer','applied','Build features for Instagram Reels with React and GraphQL.','2026-03-08',NULL,140000,200000),
('11111111-0004-4000-8000-000000000004','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Microsoft','Senior Backend Engineer','offer','Join the Azure DevOps team building CI/CD tooling used by millions of developers.','2026-02-20',NULL,150000,210000),
('11111111-0005-4000-8000-000000000005','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Stripe','Backend Engineer','interviewing','Build payment APIs and fraud detection systems at global scale.','2026-02-25',NULL,155000,195000),
('11111111-0006-4000-8000-000000000006','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Netflix','Senior Software Engineer','rejected','Work on the content delivery platform serving 250M subscribers worldwide.','2026-02-15',NULL,170000,230000),
('11111111-0007-4000-8000-000000000007','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Airbnb','Software Engineer','applied','Develop guest checkout flow and pricing algorithms for the Airbnb marketplace.','2026-03-10','2026-05-01',130000,175000),
('11111111-0008-4000-8000-000000000008','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Uber','Senior Platform Engineer','interviewing','Build internal developer platform and tooling used by 3000 engineers.','2026-03-03',NULL,145000,195000),
('11111111-0009-4000-8000-000000000009','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Lyft','Backend Engineer','applied','Scale Lyft''s ride-matching engine to handle millions of rides per day.','2026-03-12',NULL,125000,165000),
('11111111-0010-4000-8000-000000000010','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Shopify','Staff Engineer','applied','Lead technical direction for Shopify''s checkout and payments platform.','2026-03-14',NULL,165000,215000),
('11111111-0011-4000-8000-000000000011','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Datadog','Software Engineer','applied','Build observability tooling and metrics ingestion pipeline in Go.','2026-03-15',NULL,130000,170000),
('11111111-0012-4000-8000-000000000012','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Snowflake','Senior Software Engineer','rejected','Work on query optimizer and execution engine for Snowflake''s cloud data platform.','2026-02-18',NULL,155000,205000),
('11111111-0013-4000-8000-000000000013','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Databricks','ML Platform Engineer','applied','Build tooling for large-scale distributed ML training on Apache Spark.','2026-03-16',NULL,145000,190000),
('11111111-0014-4000-8000-000000000014','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Confluent','Software Engineer','interviewing','Develop Kafka-as-a-service features and multi-cloud connectors.','2026-02-28',NULL,130000,170000),
('11111111-0015-4000-8000-000000000015','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Cloudflare','Backend Engineer','applied','Build Workers serverless platform and DDoS mitigation systems.','2026-03-17',NULL,135000,175000),
('11111111-0016-4000-8000-000000000016','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Vercel','Frontend Infrastructure Engineer','applied','Scale Next.js deployment platform and edge network infrastructure.','2026-03-18',NULL,125000,160000),
('11111111-0017-4000-8000-000000000017','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Figma','Senior Software Engineer','interviewing','Build collaborative design features for Figma''s real-time multiplayer engine.','2026-03-01',NULL,150000,200000),
('11111111-0018-4000-8000-000000000018','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Notion','Full Stack Engineer','applied','Develop block-based editor and real-time collaboration features.','2026-03-19',NULL,130000,170000),
('11111111-0019-4000-8000-000000000019','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Linear','Software Engineer','applied','Build the Linear issue tracker with focus on performance and UX.','2026-03-20',NULL,130000,165000),
('11111111-0020-4000-8000-000000000020','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Twilio','Senior Software Engineer','rejected','Build SMS/voice API infrastructure processing billions of messages monthly.','2026-02-22',NULL,140000,180000),
('11111111-0021-4000-8000-000000000021','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Palantir','Forward Deployed Engineer','applied','Deploy and customize data analytics platforms for government and enterprise.','2026-03-21',NULL,130000,170000),
('11111111-0022-4000-8000-000000000022','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Robinhood','Backend Engineer','applied','Build trading engine and brokerage APIs supporting 20M retail investors.','2026-03-22',NULL,130000,170000),
('11111111-0023-4000-8000-000000000023','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Coinbase','Senior Software Engineer','applied','Develop crypto exchange infrastructure and wallet management systems.','2026-03-23',NULL,140000,185000),
('11111111-0024-4000-8000-000000000024','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','DoorDash','Software Engineer','interviewing','Scale real-time order routing and delivery logistics for DoorDash''s marketplace.','2026-03-04',NULL,125000,165000),
('11111111-0025-4000-8000-000000000025','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Instacart','Backend Engineer','applied','Build grocery delivery routing engine and warehouse management systems.','2026-03-24',NULL,120000,160000),
('11111111-0026-4000-8000-000000000026','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Salesforce','Senior Software Engineer','rejected','Develop CRM platform features for Sales Cloud used by Fortune 500 companies.','2026-02-19',NULL,140000,185000),
('11111111-0027-4000-8000-000000000027','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','HubSpot','Full Stack Developer','applied','Build marketing automation and CRM features for HubSpot Growth Platform.','2026-03-25',NULL,120000,155000),
('11111111-0028-4000-8000-000000000028','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Atlassian','Senior Software Engineer','applied','Improve Jira''s performance and reliability for enterprise customers.','2026-03-26','2026-05-15',135000,175000),
('11111111-0029-4000-8000-000000000029','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','HashiCorp','Platform Engineer','applied','Build Terraform Cloud and Vault enterprise infrastructure tools.','2026-03-27',NULL,140000,180000),
('11111111-0030-4000-8000-000000000030','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Elastic','Software Engineer','applied','Develop Elasticsearch query engine and distributed indexing features.','2026-03-28',NULL,130000,170000),
('11111111-0031-4000-8000-000000000031','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','MongoDB','Senior Software Engineer','applied','Work on MongoDB Atlas serverless and vector search features.','2026-03-29',NULL,140000,185000),
('11111111-0032-4000-8000-000000000032','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','PagerDuty','Backend Engineer','applied','Build incident management automation and on-call scheduling systems.','2026-03-30',NULL,125000,160000),
('11111111-0033-4000-8000-000000000033','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Rippling','Software Engineer','interviewing','Build HR and payroll automation platform integrations and workflows.','2026-03-06',NULL,130000,170000),
('11111111-0034-4000-8000-000000000034','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Gusto','Senior Backend Engineer','applied','Develop payroll calculation engine and HR compliance features.','2026-03-31',NULL,130000,168000),
('11111111-0035-4000-8000-000000000035','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Brex','Software Engineer','applied','Build corporate card and expense management platform for startups.','2026-04-01',NULL,130000,165000),
('11111111-0036-4000-8000-000000000036','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Carta','Backend Engineer','applied','Develop equity management and cap table software for private companies.','2026-04-02',NULL,120000,155000),
('11111111-0037-4000-8000-000000000037','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Plaid','Senior Software Engineer','rejected','Build financial data infrastructure connecting banks and fintech applications.','2026-02-16',NULL,150000,200000),
('11111111-0038-4000-8000-000000000038','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Apple','Software Engineer','applied','Develop frameworks for iOS and macOS applications used by billions of users.','2026-04-03',NULL,150000,200000),
('11111111-0039-4000-8000-000000000039','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Square','Backend Engineer','applied','Build payment processing APIs and point-of-sale systems for merchants.','2026-04-04',NULL,130000,170000),
('11111111-0040-4000-8000-000000000040','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Adobe','Senior Software Engineer','applied','Work on Creative Cloud platform and document services APIs.','2026-04-05',NULL,145000,190000),
('11111111-0041-4000-8000-000000000041','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','PayPal','Software Engineer','applied','Develop merchant payment APIs and fraud detection systems.','2026-04-06',NULL,125000,165000),
('11111111-0042-4000-8000-000000000042','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Oracle','Senior Software Engineer','rejected','Build Oracle Cloud Infrastructure compute and networking services.','2026-02-17',NULL,140000,185000),
('11111111-0043-4000-8000-000000000043','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Airtable','Full Stack Engineer','applied','Develop low-code platform features and database synchronisation tools.','2026-04-07',NULL,130000,168000),
('11111111-0044-4000-8000-000000000044','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Zendesk','Backend Engineer','applied','Build customer support platform APIs and AI-assisted ticket routing.','2026-04-08',NULL,120000,155000),
('11111111-0045-4000-8000-000000000045','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Fastly','Platform Engineer','applied','Develop CDN edge compute platform and real-time traffic routing systems.','2026-04-09',NULL,135000,175000),
('11111111-0046-4000-8000-000000000046','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','New Relic','Senior Software Engineer','applied','Build observability SaaS platform and distributed tracing features.','2026-04-10',NULL,130000,170000),
('11111111-0047-4000-8000-000000000047','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','GitHub','Staff Engineer','interviewing','Lead technical strategy for GitHub Actions and Codespaces developer tools.','2026-03-07',NULL,175000,235000),
('11111111-0048-4000-8000-000000000048','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','LinkedIn','Senior Software Engineer','applied','Develop LinkedIn Feed ranking algorithms and creator tools.','2026-04-11',NULL,145000,195000),
('11111111-0049-4000-8000-000000000049','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','Anthropic','AI Platform Engineer','offer','Build infrastructure and tooling to train and serve large language models.','2026-02-21',NULL,175000,250000),
('11111111-0050-4000-8000-000000000050','a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11','OpenAI','Software Engineer','applied','Develop API infrastructure and safety tooling for GPT model deployments.','2026-04-12','2026-05-01',160000,220000);
