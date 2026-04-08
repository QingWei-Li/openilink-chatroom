// Sync chatroom commands as tools to Hub

interface Tool {
  name: string;
  description: string;
  command: string;
  parameters?: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

function getChatroomTools(): Tool[] {
  return [
    {
      name: "join",
      description: "加入或创建聊天室",
      command: "join",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "房间名" } },
        required: ["text"],
      },
    },
    { name: "leave", description: "离开当前聊天室", command: "leave" },
    { name: "who", description: "查看当前房间成员", command: "who" },
    { name: "rooms", description: "查看所有聊天室", command: "rooms" },
    {
      name: "nick",
      description: "修改昵称",
      command: "nick",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "新昵称" } },
        required: ["text"],
      },
    },
    {
      name: "topic",
      description: "设置房间话题",
      command: "topic",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "话题内容" } },
        required: ["text"],
      },
    },
  ];
}

export async function syncTools(hubUrl: string, appToken: string): Promise<void> {
  const tools = getChatroomTools();
  await fetch(`${hubUrl}/bot/v1/app/tools`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${appToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tools }),
  });
}
