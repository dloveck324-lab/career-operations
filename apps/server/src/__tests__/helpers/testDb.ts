import Database from 'better-sqlite3'
import { runMigrations } from '../../db/migrations.js'

export const db = new Database(':memory:')
runMigrations(db)
