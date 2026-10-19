import DB from '../database';
import logger from '../logger';

/**
 * Database changes the Chains profiles need on top of upstream's schema, applied after its migrations (kept out of
 * database-migration.ts so that upstream's schema versions stay untouched). Each one is idempotent.
 *
 *  - blocks.header: FastBlocks blocks of stake have a 176-byte header (80 + hashSections 32 + signature 64), 352 hex
 *    characters; upstream's column holds the 80-byte Bitcoin header (160).
 */
export async function chainDatabaseFixups(): Promise<void> {
  try {
    const [rows]: any = await DB.query(`SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blocks' AND COLUMN_NAME = 'header'`);
    if (rows?.[0] && rows[0].len < 400) {
      await DB.query('ALTER TABLE blocks MODIFY header varchar(400) NOT NULL');
      logger.notice('Chains Explorer: blocks.header widened to 400 characters (FastBlocks headers)');
    }
  } catch (e) {
    logger.warn('Chains Explorer: database fixups: ' + (e instanceof Error ? e.message : e));
  }
}
