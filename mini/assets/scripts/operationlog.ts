const LABELS = {
  appOpened: "打开 H5",
  releaseFailed: "资源加载失败",
  login: "点击登录",
  resume: "恢复会话",
  register: "点击一键注册",
  registerFailed: "注册失败",
  loginFailed: "进入游戏失败",
  connected: "连接游戏网关",
  disconnected: "游戏连接已断开",
  connectionError: "游戏连接异常",
  city: "进入主城",
  heroes: "打开英雄列表",
  backpack: "打开背包",
  campaign: "打开主线关卡",
  otherTab: "点击底部入口",
  hero: "查看英雄详情",
  heroLevel: "点击英雄升级",
  formation: "打开布阵",
  preview: "打开技能预览",
  previewFailed: "技能预览加载失败",
  skill: "点击预览技能",
  skillPlayed: "技能播放完成",
  skillMissing: "缺少技能动作素材",
  skillFailed: "技能播放失败",
  boss: "点击挑战首领",
  battle: "开始主线战斗",
  battleWon: "主线战斗胜利",
  battleLost: "主线战斗失败",
  quick: "打开快速作战",
  actionFailed: "操作请求失败",
} as const;

export const H5_OPERATION_LOG_PREFIX = "2dround-h5-ops/v1\n";
const MAX_OPERATIONS = 32;

export class OperationLog {
  private lines: string[] = [];
  private release = "未知";
  private readonly clientVersion: string;

  constructor(clientVersion: string) {
    this.clientVersion = clientVersion;
  }

  setRelease(version: string): void {
    if (/^[\w.-]{1,40}$/.test(version)) this.release = version;
  }

  // Labels are fixed. Only public game IDs may be included, never role IDs, form input or network payloads.
  record(action: keyof typeof LABELS, publicId?: number): void {
    const detail = typeof publicId === "number" && Number.isSafeInteger(publicId) && publicId > 0 ? ` #${publicId}` : "";
    const time = new Date().toISOString().slice(0, 19).replace("T", " ");
    this.lines.push(`${time}Z ${LABELS[action]}${detail}`);
    if (this.lines.length > MAX_OPERATIONS) this.lines.shift();
  }

  snapshot(): string {
    return [`H5 ${this.clientVersion} · 资源 ${this.release} · UTC`, ...this.lines].join("\n");
  }
}
