import discord
import asyncio
import os
from discord.ext import commands
import config

intents = discord.Intents.default()
intents.message_content = True 
intents.members = True
intents.guilds = True

bot = commands.Bot(command_prefix="!", intents=intents)

@bot.event
async def on_ready():
    
    try:
        synced = await bot.tree.sync()
        print(f"コマンド同期: {len(synced)}")
    except Exception as e:
        print(f"同期エラー: {e}")

async def load_extensions():
    for filename in os.listdir("./cogs"):
        if filename.endswith(".py"):
            try:
                await bot.load_extension(f"cogs.{filename[:-3]}")
                print(f"ロード完了")
            except Exception as e:
                print(f"ロード失敗")

async def main():
    if not config.TOKEN:
        print("エラー")
        return

    async with bot:
        await load_extensions()
        try:
            await bot.start(config.TOKEN)
        except discord.LoginFailure:
            print("トークン無効")
        except Exception as e:
            print(f"エラー； {e}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("停止")
