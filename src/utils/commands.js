const { REST, Routes } = require('discord.js');

async function registerGuildCommands(client, commands, guildIds, token) {
  const rest = new REST({ version: '10' }).setToken(token);
  const commandBodies = commands.map((command) => command.data.toJSON());

  for (const guildId of guildIds) {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, guildId),
      { body: commandBodies },
    );
    console.log(`[commands] Registered ${commandBodies.length} guild commands for ${guildId}`);
  }
}

module.exports = { registerGuildCommands };
