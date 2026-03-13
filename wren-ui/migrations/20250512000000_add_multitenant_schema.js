
exports.up = async function (knex) {
  // ── USER ─────────────────────────────────────────────────────────────────
  const hasUser = await knex.schema.hasTable('user');
  if (!hasUser) {
    await knex.schema.createTable('user', (table) => {
      table.increments('id').comment('ID');
      table.string('email').notNullable().unique().comment('unique email address');
      table.string('name').nullable().comment('display name');
      table.string('avatar_url').nullable().comment('profile picture URL');
      table.string('password_hash').nullable().comment('null for SSO-only accounts');
      table.boolean('mfa_enabled').notNullable().defaultTo(false).comment('MFA enabled flag');
      table.string('mfa_secret').nullable().comment('TOTP secret');
      table.timestamp('last_login_at').nullable().comment('last successful login');
      table.timestamps(true, true);
    });
    console.log('  ✅  created table: user');
  } else {
    console.log('  ⏭️   skipped (exists): user');
  }

  // ── SESSION ───────────────────────────────────────────────────────────────
  await knex.schema.createTable('session', (table) => {
    table.increments('id').comment('ID');
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('user').onDelete('CASCADE').comment('FK → user');
    table.string('token').notNullable().unique().comment('opaque session token');
    table.timestamp('expires_at').notNullable().comment('expiry timestamp');
    table.string('ip').nullable().comment('client IP at login');
    table.string('user_agent').nullable().comment('browser / client UA');
    table.timestamps(true, true);
    table.index(['user_id'], 'session_user_id_idx');
  });
  console.log('  ✅  created table: session');

  // ── ORGANIZATION ──────────────────────────────────────────────────────────
  await knex.schema.createTable('organization', (table) => {
    table.increments('id').comment('ID');
    table.string('name').notNullable().comment('display name');
    table.string('slug').notNullable().unique().comment('URL-safe unique identifier');
    table.string('industry').nullable().comment('industry vertical');
    table.string('region').notNullable().defaultTo('ap-south-1').comment('primary data region');
    table.string('logo_url').nullable().comment('logo image URL');
    table.string('plan').notNullable().defaultTo('starter')
      .comment('billing plan: starter | pro | enterprise');
    table.timestamps(true, true);
  });
  console.log('  ✅  created table: organization');

  // ── ORG MEMBER ────────────────────────────────────────────────────────────
  await knex.schema.createTable('org_member', (table) => {
    table.increments('id').comment('ID');
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('user').onDelete('RESTRICT').comment('FK → user');
    table.integer('org_id').unsigned().notNullable()
      .references('id').inTable('organization').onDelete('RESTRICT').comment('FK → organization');
    table.enu('role', ['OWNER', 'ORG_ADMIN', 'MEMBER', 'VIEWER'])
      .notNullable().defaultTo('MEMBER').comment('org-level RBAC role');
    table.timestamp('joined_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['user_id', 'org_id'], 'org_member_user_org_unique');
    table.index(['org_id'],  'org_member_org_id_idx');
    table.index(['user_id'], 'org_member_user_id_idx');
  });
  console.log('  ✅  created table: org_member');

  // ── TEAM ──────────────────────────────────────────────────────────────────
  await knex.schema.createTable('team', (table) => {
    table.increments('id').comment('ID');
    table.integer('org_id').unsigned().notNullable()
      .references('id').inTable('organization').onDelete('RESTRICT').comment('FK → organization');
    table.string('name').notNullable().comment('team display name');
    table.string('description').nullable();
    table.timestamps(true, true);
    table.index(['org_id'], 'team_org_id_idx');
  });
  console.log('  ✅  created table: team');

  // ── TEAM USER ─────────────────────────────────────────────────────────────
  await knex.schema.createTable('team_user', (table) => {
    table.increments('id').comment('ID');
    table.integer('team_id').unsigned().notNullable()
      .references('id').inTable('team').onDelete('RESTRICT').comment('FK → team');
    table.integer('org_member_id').unsigned().notNullable()
      .references('id').inTable('org_member').onDelete('RESTRICT').comment('FK → org_member');
    table.enu('role', ['LEAD', 'MEMBER', 'VIEWER']).notNullable().defaultTo('MEMBER');
    table.timestamp('joined_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['team_id', 'org_member_id'], 'team_user_team_member_unique');
    table.index(['team_id'],      'team_user_team_id_idx');
    table.index(['org_member_id'],'team_user_org_member_id_idx');
  });
  console.log('  ✅  created table: team_user');

  // ── WORKSPACE ─────────────────────────────────────────────────────────────
  await knex.schema.createTable('workspace', (table) => {
    table.increments('id').comment('ID');
    table.integer('org_id').unsigned().notNullable()
      .references('id').inTable('organization').onDelete('RESTRICT').comment('FK → organization');
    table.string('name').notNullable().comment('workspace display name');
    table.string('description').nullable();
    table.string('visibility').notNullable().defaultTo('team').comment('team | org | private');
    table.timestamps(true, true);
    table.index(['org_id'], 'workspace_org_id_idx');
  });
  console.log('  ✅  created table: workspace');

  // ── WORKSPACE TEAM ────────────────────────────────────────────────────────
  await knex.schema.createTable('workspace_team', (table) => {
    table.increments('id').comment('ID');
    table.integer('workspace_id').unsigned().notNullable()
      .references('id').inTable('workspace').onDelete('RESTRICT').comment('FK → workspace');
    table.integer('team_id').unsigned().notNullable()
      .references('id').inTable('team').onDelete('RESTRICT').comment('FK → team');
    table.enu('role', ['ADMIN', 'MEMBER', 'VIEWER']).notNullable().defaultTo('MEMBER');
    table.unique(['workspace_id', 'team_id'], 'workspace_team_unique');
    table.index(['workspace_id'], 'workspace_team_workspace_id_idx');
    table.index(['team_id'],      'workspace_team_team_id_idx');
  });
  console.log('  ✅  created table: workspace_team');

  // ── WORKSPACE MEMBER ──────────────────────────────────────────────────────
  await knex.schema.createTable('workspace_member', (table) => {
    table.increments('id').comment('ID');
    table.integer('workspace_id').unsigned().notNullable()
      .references('id').inTable('workspace').onDelete('RESTRICT').comment('FK → workspace');
    table.integer('org_member_id').unsigned().notNullable()
      .references('id').inTable('org_member').onDelete('RESTRICT').comment('FK → org_member');
    table.enu('role', ['ADMIN', 'MEMBER', 'VIEWER']).notNullable().defaultTo('MEMBER');
    table.timestamp('granted_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['workspace_id', 'org_member_id'], 'workspace_member_unique');
    table.index(['workspace_id'],  'workspace_member_workspace_id_idx');
    table.index(['org_member_id'], 'workspace_member_org_member_id_idx');
  });
  console.log('  ✅  created table: workspace_member');

  // ── PROJECT (alter existing wren-ui table) ────────────────────────────────
  // Option A — existing table: adds workspace_id FK column only.
  // Option B — fresh DB: comment out alterTable and uncomment createTable below.
  const hasProject = await knex.schema.hasTable('project');
  if (hasProject) {
    await knex.schema.alterTable('project', (table) => {
      table.integer('workspace_id').unsigned().nullable()
        .references('id').inTable('workspace').onDelete('RESTRICT')
        .comment('FK → workspace (back-fill via seed script)');
      table.index(['workspace_id'], 'project_workspace_id_idx');
    });
    console.log('  ✅  altered  table: project (added workspace_id)');
  } else {
    await knex.schema.createTable('project', (table) => {
      table.increments('id').comment('ID');
      table.integer('workspace_id').unsigned().notNullable()
        .references('id').inTable('workspace').onDelete('RESTRICT');
      table.string('type').comment('datasource type');
      table.string('display_name').comment('project display name');
      table.text('credentials').nullable();
      table.string('project_id').nullable().comment('GCP project id (BigQuery)');
      table.string('dataset_id').nullable().comment('BigQuery datasetId');
      table.jsonb('init_sql').nullable();
      table.jsonb('extensions').nullable();
      table.jsonb('configurations').nullable();
      table.string('catalog');
      table.string('schema');
      table.string('sample_dataset').nullable();
      table.timestamps(true, true);
      table.index(['workspace_id'], 'project_workspace_id_idx');
    });
    console.log('  ✅  created table: project');
  }

  // ── INVITE ────────────────────────────────────────────────────────────────
  await knex.schema.createTable('invite', (table) => {
    table.increments('id').comment('ID');
    table.integer('org_id').unsigned().notNullable()
      .references('id').inTable('organization').onDelete('RESTRICT');
    table.string('email').notNullable();
    table.enu('role', ['OWNER', 'ORG_ADMIN', 'MEMBER', 'VIEWER'])
      .notNullable().defaultTo('MEMBER');
    table.integer('team_id').unsigned().nullable();
    table.string('token').notNullable().unique();
    table.enu('status', ['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'])
      .notNullable().defaultTo('PENDING');
    table.timestamp('expires_at').notNullable();
    table.integer('invited_by_id').unsigned().notNullable();
    table.timestamps(true, true);
    table.index(['org_id'],  'invite_org_id_idx');
    table.index(['email'],   'invite_email_idx');
    table.index(['status'],  'invite_status_idx');
  });
  console.log('  ✅  created table: invite');

  // ── DOMAIN ────────────────────────────────────────────────────────────────
  await knex.schema.createTable('domain', (table) => {
    table.increments('id').comment('ID');
    table.integer('org_id').unsigned().notNullable()
      .references('id').inTable('organization').onDelete('RESTRICT');
    table.string('domain').notNullable();
    table.boolean('verified').notNullable().defaultTo(false);
    table.boolean('auto_join').notNullable().defaultTo(false);
    table.timestamps(true, true);
    table.unique(['org_id', 'domain'], 'domain_org_domain_unique');
    table.index(['org_id'],  'domain_org_id_idx');
    table.index(['domain'],  'domain_domain_idx');
  });
  console.log('  ✅  created table: domain');

  // ── API KEY ───────────────────────────────────────────────────────────────
  await knex.schema.createTable('api_key', (table) => {
    table.increments('id').comment('ID');
    table.integer('org_id').unsigned().notNullable()
      .references('id').inTable('organization').onDelete('RESTRICT');
    table.string('name').notNullable();
    table.string('key_hash').notNullable().unique();
    table.string('key_prefix').notNullable();
    table.string('scope').notNullable();
    table.integer('created_by_id').unsigned().notNullable();
    table.timestamp('expires_at').nullable();
    table.timestamp('last_used_at').nullable();
    table.timestamp('revoked_at').nullable();
    table.timestamps(true, true);
    table.index(['org_id'], 'api_key_org_id_idx');
  });
  console.log('  ✅  created table: api_key');

  // ── SSO CONFIG ────────────────────────────────────────────────────────────
  await knex.schema.createTable('sso_config', (table) => {
    table.increments('id').comment('ID');
    table.integer('org_id').unsigned().notNullable().unique()
      .references('id').inTable('organization').onDelete('RESTRICT');
    table.string('provider').notNullable().comment('google | microsoft | okta | saml');
    table.string('domain').notNullable();
    table.string('client_id').nullable();
    table.string('client_secret').nullable();
    table.string('metadata_url').nullable();
    table.boolean('auto_provision').notNullable().defaultTo(true);
    table.boolean('scim_enabled').notNullable().defaultTo(false);
    table.boolean('sso_enforced').notNullable().defaultTo(false);
    table.timestamps(true, true);
  });
  console.log('  ✅  created table: sso_config');

  // ── SECURITY POLICY ───────────────────────────────────────────────────────
  await knex.schema.createTable('security_policy', (table) => {
    table.increments('id').comment('ID');
    table.integer('org_id').unsigned().notNullable().unique()
      .references('id').inTable('organization').onDelete('RESTRICT');
    table.boolean('require_mfa').notNullable().defaultTo(false);
    table.boolean('sso_enforced').notNullable().defaultTo(false);
    table.integer('session_timeout_mins').notNullable().defaultTo(480);
    table.jsonb('ip_allowlist').notNullable().defaultTo(JSON.stringify([]));
    table.string('data_residency').notNullable().defaultTo('ap-south-1');
    table.boolean('audit_logging').notNullable().defaultTo(true);
    table.boolean('pii_masking').notNullable().defaultTo(false);
    table.boolean('export_restricted').notNullable().defaultTo(false);
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  console.log('  ✅  created table: security_policy');

  // ── AUDIT LOG ─────────────────────────────────────────────────────────────
  await knex.schema.createTable('audit_log', (table) => {
    table.increments('id').comment('ID');
    table.integer('org_id').unsigned().notNullable()
      .references('id').inTable('organization').onDelete('RESTRICT');
    table.integer('actor_id').unsigned().nullable()
      .references('id').inTable('user').onDelete('SET NULL');
    table.enu('action', [
      'LOGIN','LOGIN_FAILED','LOGOUT','SSO_LOGIN',
      'MEMBER_INVITE','MEMBER_REMOVE','ROLE_CHANGE',
      'TEAM_CREATE','TEAM_DELETE',
      'WORKSPACE_CREATE','WORKSPACE_DELETE',
      'PROJECT_CREATE','PROJECT_DELETE',
      'MODEL_DEPLOY','DATA_EXPORT',
      'API_KEY_CREATE','API_KEY_REVOKE',
      'SSO_CONFIGURE','POLICY_UPDATE',
    ]).notNullable();
    table.string('resource_type').nullable();
    table.string('resource_id').nullable();
    table.jsonb('metadata').nullable();
    table.string('ip').nullable();
    table.string('user_agent').nullable();
    table.boolean('success').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['org_id', 'created_at'],        'audit_log_org_created_at_idx');
    table.index(['actor_id'],                    'audit_log_actor_id_idx');
    table.index(['action'],                      'audit_log_action_idx');
    table.index(['resource_type','resource_id'], 'audit_log_resource_idx');
  });
  console.log('  ✅  created table: audit_log');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('security_policy');
  await knex.schema.dropTableIfExists('sso_config');
  await knex.schema.dropTableIfExists('api_key');
  await knex.schema.dropTableIfExists('domain');
  await knex.schema.dropTableIfExists('invite');

  const hasWorkspaceId = await knex.schema.hasColumn('project', 'workspace_id');
  if (hasWorkspaceId) {
    await knex.schema.alterTable('project', (table) => {
      table.dropIndex([], 'project_workspace_id_idx');
      table.dropColumn('workspace_id');
    });
  } else {
    await knex.schema.dropTableIfExists('project');
  }

  await knex.schema.dropTableIfExists('workspace_member');
  await knex.schema.dropTableIfExists('workspace_team');
  await knex.schema.dropTableIfExists('workspace');
  await knex.schema.dropTableIfExists('team_user');
  await knex.schema.dropTableIfExists('team');
  await knex.schema.dropTableIfExists('org_member');
  await knex.schema.dropTableIfExists('organization');
  await knex.schema.dropTableIfExists('session');
  // 'user' intentionally NOT dropped to protect existing wren-ui data.
};
