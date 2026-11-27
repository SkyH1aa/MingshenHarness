import { MANAGED_POLICY_USER_SETTING } from "../../shared/managed-policy";
import { ManagedPolicyService } from "../policy/managed-policy-service";

export function assertUpdateInstallerLaunch(
  userPolicy: unknown,
  approved: boolean,
  machinePolicyPath?: string,
): void {
  const policy = new ManagedPolicyService(
    {
      getSetting: (key) => (key === MANAGED_POLICY_USER_SETTING ? userPolicy : null),
      getProvider: () => null,
      getModel: () => null,
    },
    machinePolicyPath === undefined ? {} : { machinePolicyPath },
  );
  policy.assertOperational("启动更新安装器");
  policy.assertCapability("command.execute", { approved });
}
