export interface FeishuCardPusherConfig {
  appId: string;
  appSecret: string;
  baseUrl?: string;
}

export interface SendCardArgs {
  receiveId: string;
  receiveIdType?: "open_id" | "user_id" | "union_id" | "chat_id" | "email";
  card: Record<string, any>;
}

export interface UpdateCardArgs {
  messageId: string;
  card: Record<string, any>;
}

export interface SendTextArgs {
  receiveId: string;
  receiveIdType?: "open_id" | "user_id" | "union_id" | "chat_id" | "email";
  text: string;
}

export class FeishuCardPusher {
  private baseUrl: string;

  constructor(private config: FeishuCardPusherConfig) {
    this.baseUrl = config.baseUrl ?? "https://open.feishu.cn/open-apis";
  }

  async getTenantAccessToken(): Promise<string> {
    const resp = await fetch(
      `${this.baseUrl}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
      }
    );

    const data = await resp.json();
    if (!resp.ok || data.code !== 0) {
      throw new Error(
        `Failed to get tenant access token: ${JSON.stringify(data)}`
      );
    }

    return data.tenant_access_token;
  }

  async sendCard(args: SendCardArgs): Promise<string> {
    const token = await this.getTenantAccessToken();

    const resp = await fetch(
      `${this.baseUrl}/im/v1/messages?receive_id_type=${args.receiveIdType ?? "chat_id"}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          receive_id: args.receiveId,
          msg_type: "interactive",
          content: JSON.stringify(args.card.card ?? args.card),
        }),
      }
    );

    const data = await resp.json();
    if (!resp.ok || data.code !== 0) {
      throw new Error(`Failed to send card: ${JSON.stringify(data)}`);
    }

    return data.data.message_id;
  }

  async sendText(args: SendTextArgs): Promise<string> {
    const token = await this.getTenantAccessToken();

    const resp = await fetch(
      `${this.baseUrl}/im/v1/messages?receive_id_type=${args.receiveIdType ?? "chat_id"}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          receive_id: args.receiveId,
          msg_type: "text",
          content: JSON.stringify({ text: args.text }),
        }),
      }
    );

    const data = await resp.json();
    if (!resp.ok || data.code !== 0) {
      throw new Error(`Failed to send text: ${JSON.stringify(data)}`);
    }

    return data.data.message_id;
  }

  async updateCard(args: UpdateCardArgs): Promise<void> {
    const token = await this.getTenantAccessToken();

    const resp = await fetch(
      `${this.baseUrl}/im/v1/messages/${args.messageId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          content: JSON.stringify(args.card.card ?? args.card),
        }),
      }
    );

    const data = await resp.json();
    if (!resp.ok || data.code !== 0) {
      throw new Error(`Failed to update card: ${JSON.stringify(data)}`);
    }
  }
}
