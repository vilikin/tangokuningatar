// The subset of Telegram Bot API types this Worker reads.
// Reference: https://core.telegram.org/bots/api#available-types

export interface Update {
  update_id: number;
  message?: Message;
  my_chat_member?: ChatMemberUpdated;
}

export interface User {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface Chat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface Message {
  message_id: number;
  date: number;
  chat: Chat;
  from?: User;
  sender_chat?: Chat;
  text?: string;
  caption?: string;
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
}

export interface ChatMember {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  user: User;
}

export interface ChatMemberUpdated {
  chat: Chat;
  from: User;
  date: number;
  old_chat_member: ChatMember;
  new_chat_member: ChatMember;
}
