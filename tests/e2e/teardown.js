import { E2E_DOMAIN, E2E_PREFIX, withDatabase } from './helpers.js';

/* Les tests écrivent dans la base de développement : on retire ce qu'ils ont créé. */
export default async function globalTeardown(){
  await withDatabase(async client => {
    const contributions = await client.query(`DELETE FROM contributions WHERE email LIKE $1 RETURNING id`, [`%@${E2E_DOMAIN}`]);
    const summaries = await client.query(`DELETE FROM summaries WHERE title LIKE $1 RETURNING id`, [`${E2E_PREFIX}%`]);
    const tags = await client.query(`DELETE FROM admin_tags WHERE name LIKE $1 RETURNING id`, [`${E2E_PREFIX}%`]);
    const users = await client.query(`DELETE FROM admin_users WHERE email LIKE $1 RETURNING id`, [`%@${E2E_DOMAIN}`]);
    console.log(`Nettoyage E2E : ${contributions.rowCount} contribution(s), ${summaries.rowCount} synthèse(s), ${tags.rowCount} tag(s), ${users.rowCount} compte(s).`);
  });
}
