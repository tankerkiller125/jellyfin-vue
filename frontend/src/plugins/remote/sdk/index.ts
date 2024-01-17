/**
 * This plugin instantiates the Jellyfin SDK.
 * It also sets the header and base URL for our axios instance
 */
import { isNil } from '@/utils/validation';
import type { Api } from '@jellyfin/sdk';
import { watchEffect } from 'vue';
import RemotePluginAuthInstance from '../auth';
import RemotePluginAxiosInstance from '../axios';
import SDK, { useOneTimeAPI } from './sdk-utils';

class RemotePluginSDK {
  private sdk = SDK;
  public clientInfo = this.sdk.clientInfo;
  public deviceInfo = this.sdk.deviceInfo;
  public discovery = this.sdk.discovery;
  public api: Api | undefined;

  public constructor(auth: typeof RemotePluginAuthInstance) {
    /**
     * Configure app's axios instance to perform requests to the given Jellyfin server.
     */
    watchEffect(() => {
      const server = auth.currentServer;
      const accessToken = auth.currentUserToken;

      if (isNil(server)) {
        RemotePluginAxiosInstance.resetDefaults();
        this.api = undefined;
      } else {
        this.api = this.sdk.createApi(
          server.PublicAddress,
          accessToken,
          RemotePluginAxiosInstance.instance
        );
        RemotePluginAxiosInstance.instance.defaults.baseURL =
          server.PublicAddress;
      }
    });
  }

  public oneTimeSetup = useOneTimeAPI;
  /**
   * Generates a Jellyfin API type with the current API instance.
   *
   * USE WITH CAUTION. Make sure this is only used in places where an user is logged in
   */
  public newUserApi<T>(apiSec: (api: Api) => T): T {
    // We want to explicitly assume the user is already logged in here
    return apiSec(this.api as Api);
  }
}

const RemotePluginSDKInstance = new RemotePluginSDK(RemotePluginAuthInstance);

export default RemotePluginSDKInstance;
