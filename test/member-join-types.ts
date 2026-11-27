import type { Client, MemberJoinEvent } from '../dist';

const installation = {
  tavernId: 'tavern',
  user: { id: 'bot', displayName: 'Greeter', avatarUrl: null },
  isBot: true,
  botApplicationId: 'app',
} satisfies MemberJoinEvent;

declare const client: Client;
client.on('memberJoin', (event) => {
  if (event.isBot) {
    const absent: undefined = event.member;
    return [event.botApplicationId, absent];
  }
  return event.member.nickname ?? event.user.displayName;
});

client.emit('memberJoin', installation);
