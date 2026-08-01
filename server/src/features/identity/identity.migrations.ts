import { RoleModel } from './models/role.model';
import { roleCatalog } from '../../shared/identity/rbac';
import { isMongoReady } from '../../shared/db/mongo';
import { writeStructuredLog } from '../../shared/logging/safeLogging';

export async function runIdentityMigrations(): Promise<void> {
  if (!isMongoReady()) return;
  for (const role of roleCatalog()) {
    await RoleModel.updateOne(
      { key: role.key },
      { $set: { label: role.label, permissions: role.permissions } },
      { upsert: true }
    );
  }
  writeStructuredLog({
    component: 'server',
    module: 'identity',
    event: 'IDENTITY_MIGRATIONS_COMPLETE',
    severity: 'info',
    context: { rolesSeeded: roleCatalog().length },
  });
}
