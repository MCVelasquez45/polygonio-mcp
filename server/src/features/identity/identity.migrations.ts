import { RoleModel } from './models/role.model';
import { roleCatalog } from '../../shared/identity/rbac';
import { isMongoReady } from '../../shared/db/mongo';
import { writeStructuredLog } from '../../shared/logging/safeLogging';
import { OAuthAttemptModel } from './models/oauthAttempt.model';
import { BrokerConnectionModel } from './models/brokerConnection.model';
import { BrokerOAuthAttemptModel } from '../brokerage/models/brokerOAuthAttempt.model';
import { BrokerPortfolioModel } from '../brokerage/models/brokerPortfolio.model';

export async function runIdentityMigrations(): Promise<void> {
  if (!isMongoReady()) return;
  await OAuthAttemptModel.syncIndexes();
  await BrokerConnectionModel.syncIndexes();
  await BrokerOAuthAttemptModel.syncIndexes();
  await BrokerPortfolioModel.syncIndexes();
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
