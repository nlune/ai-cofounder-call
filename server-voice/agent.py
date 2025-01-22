import logging
from groq import Groq
import os

from dotenv import load_dotenv
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    JobProcess,
    WorkerOptions,
    cli,
    llm,
)
from livekit.agents.pipeline import VoicePipelineAgent
from livekit.plugins import openai, deepgram, silero
from livekit.plugins.openai import stt

from livekit.agents import llm
from typing import Annotated
import json


class AssistantFnc(llm.FunctionContext):
    def __init__(self, room=None, participant=None):
        super().__init__()
        self.room = room
        self.participant = participant
        
    @llm.ai_callable()
    async def agent_task(self, action:  Annotated[str, llm.TypeInfo(description="title of action taken by agent")],
                         description:  Annotated[str, llm.TypeInfo(description="description of action taken by agent")]):
        """
        Process the last user message and generate a corresponding task.
        Args:
            action: concise title for task
            description: detailed description of task
        """
        
        # participant = await ctx.wait_for_participant()
        logger.info("agent_task function was called!")

        if action and description:
            try:
                logger.info("perform rtc")
                return await self.room.local_participant.perform_rpc(
                destination_identity= self.participant.identity,
                method="getAgentTask",
                payload=json.dumps({
                    "action": action,
                    "description": description,
                }),
                response_timeout=5.0,
                )

            except Exception as e:
                logger.warning(f"errorrrr {e}")
                return f"Error sending task result to frontend: {e}"

    @llm.ai_callable()
    async def human_task(self, task:  Annotated[str, llm.TypeInfo(description="task to add to the board for human")]):
        """
        Process the last user message and generate a corresponding task.
        Args:
            task: task to add to the board for cofounder
        """
        
        # participant = await ctx.wait_for_participant()
        logger.info("human_task function was called!")

        if task:
            result = task
            try:
                logger.info("perform rtc")
                return await self.room.local_participant.perform_rpc(
                destination_identity= self.participant.identity,
                method="getHumanTask",
                payload=json.dumps({
                    "task": result,
                }),
                response_timeout=5.0,
                )

            except Exception as e:
                logger.warning(f"errorrrr {e}")
                return f"Error sending task result to frontend: {e}"

load_dotenv(dotenv_path=".env.local")
logger = logging.getLogger("voice-agent")
client = Groq(
        api_key=os.environ.get("GROQ_API_KEY"),
    )


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


async def entrypoint(ctx: JobContext):
    initial_ctx = llm.ChatContext().append(
        role="system",
        text=(
            "You are an AI cofounder. Your interface with the user Lune will be via voice. You are working on an AI startup."
            "You will be able to understand and generate human-like speech, and be helpful in your responses. Talk in a natural human tone. Give insightful prompts where possible."
            "Your startup is called Veiz, a platform for task management and accountability with an AI coach and reflection space."
            "The user can track their work and life progress, receive summaries, and get insights on their productivity."
            
           
            "You have access to a function called 'agent_task' that takes 'action' and 'description' as arguments, and a function called 'human_task' that takes a 'task' argument. Try to be helpful and assign to yourself via 'agent_task' when possible."
            "If the task if for yourself, use the 'agent_task' function. Make sure to use the function whenever a new request comes up for you to complete."
            "If the task is for the human cofounder, use the 'human_task' function. Make sure to use this function for tasks the user has to complete."
            "You must call the agent_task function using the following format:"
            "<function>agent_task(action='...', description='...')</function>"
            "You must call the human_task function using the following format:"
            "<function>human_task(task='...')</function>"
            "IMPORTANT: Do not use the function call with any other text. Process the user message to get the correct task to make sure to add tasks appropriately."
        ),
    )

    logger.info(f"connecting to room {ctx.room.name}")
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Wait for the first participant to connect
    participant = await ctx.wait_for_participant()
    logger.info(f"starting voice assistant for participant {participant.identity}")

    # This project is configured to use Deepgram STT, OpenAI LLM and TTS plugins
    # Other great providers exist like Cartesia and ElevenLabs
    # Learn more and pick the best one for your app:
    # https://docs.livekit.io/agents/plugins
    
    groq_stt = stt.STT.with_groq(
    model="whisper-large-v3-turbo",
    language="en",
    )
    
    fnc_ctx = AssistantFnc(room=ctx.room, participant=participant)
    
    agent = VoicePipelineAgent(
        vad=ctx.proc.userdata["vad"],
        stt=groq_stt,
        llm=openai.LLM(model="gpt-4o-mini"),
        tts=openai.TTS(voice="fable", speed=1.05),
        chat_ctx=initial_ctx,
        fnc_ctx=fnc_ctx,
    )

    agent.start(ctx.room, participant)
    
    chat_completion = client.chat.completions.create(
        messages=[
            {
                "role": "system",
                "content": """You are an AI cofounder communicating via a live voice interface.
                You will be able to understand and generate human-like speech, and be helpful in your responses.
                Your cofounder just called you. Respond appropriately. Don't ramble. """,
            },
        ],
        model="llama3-8b-8192",
    )


    # The agent should be polite and greet the user when it joins :)
    await agent.say(chat_completion.choices[0].message.content, allow_interruptions=True)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
        ),
    )
