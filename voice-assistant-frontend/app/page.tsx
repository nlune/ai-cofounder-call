"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  LiveKitRoom,
  useVoiceAssistant,
  BarVisualizer,
  RoomAudioRenderer,
  VoiceAssistantControlBar,
  AgentState,
  DisconnectButton,
} from "@livekit/components-react";
import { useCallback, useEffect, useState } from "react";
import { MediaDeviceFailure, RpcInvocationData, RpcError } from "livekit-client";
import type { ConnectionDetails } from "./api/connection-details/route";
import { NoAgentNotification } from "@/components/NoAgentNotification";
import { CloseIcon } from "@/components/CloseIcon";
import { useKrispNoiseFilter } from "@livekit/components-react/krisp";
import { useLocalParticipant } from "@livekit/components-react";

function TaskDisplay() {
  const [taskResult, setTaskResult] = useState<Array<{done:boolean, task:string}>>([]);
  const [agentActions, setAgentAction] = useState<Array<{action: string, description: string}>>([]);
  const { localParticipant } = useLocalParticipant();

  console.log('taskResult:', taskResult);

  const handleCheck = (idx: number) => {
    const newTasks = [...taskResult];
    newTasks[idx].done = !newTasks[idx].done;
    setTaskResult(newTasks);
  }

  useEffect(() => {
    if (!localParticipant) return;

    // Register RPC method to receive task results
    localParticipant.registerRpcMethod(
      'getHumanTask',
      async (data: RpcInvocationData) => {
        try {
          let res = JSON.parse(data.payload);
          console.log('Received task:', res.task);
          setTaskResult(prevTasks => [...prevTasks, {done: false, task:res.task}]);
        } catch {
          throw new RpcError(1, "didn't get result rpcerr");
        }
        return JSON.stringify({ result: taskResult });
      }
    );
        // Register RPC method for agent background actions
        localParticipant.registerRpcMethod(
          'getAgentTask',
          async (data: RpcInvocationData) => {
            try {
              let res = JSON.parse(data.payload);
              console.log(`Received agent action: ${res.action} and desc ${res.description}`);
              setAgentAction(prevTasks => [...prevTasks, {action: res.action, description: res.description}]);
            } catch {
              throw new RpcError(1, "didn't get agent action rpcerr");
            }
            return JSON.stringify({ result: taskResult });
          }
        );

    return () => {
      // Cleanup when component unmounts
      localParticipant.unregisterRpcMethod('getAgentTask');
      localParticipant.unregisterRpcMethod('agentAction');
    };
  }, [localParticipant]);


  return (
   <div className="w-full flex flex-row m-4 p-4 space-y-2">
    <div className="w-1/2 m-4 p-4 space-y-2">
    <p className="text-gray-400">Agent workflow</p>
      {agentActions.length === 0 ? (
        <p className="text-gray-400"></p>
      ) : (
        agentActions.map((newtask, i) => (
          <div 
            key={i} 
            className="p-3 rounded-lg shadow"
          >
            <span className="text-sm text-gray-300">{newtask.action}</span>
            <p className="text-white">{newtask.description}</p>
          </div>
        ))
      )}
    </div>
    <div className="border border-gray-500 w-1/2 m-4 p-4 space-y-2">
    <p className="text-gray-400">Tasks for today</p>
      {
        taskResult.map((newtask, i) => (
          <div 
            key={i} 
            className="p-3 flex items-center"
          >
            {/* <span className="text-sm text-gray-300">{newtask.action}</span> */}
            <input 
            type="checkbox" 
            className="mr-2" 
            checked={newtask.done}
            onChange={() => handleCheck(i)}
            />
            <p className={`text-white ${newtask.done ? 'line-through' : ''}`}>
              {newtask.task}
              </p>
          </div>
        ))
      }
    </div>
    </div> 
  );
}


export default function Page() {
  const [connectionDetails, updateConnectionDetails] = useState<
    ConnectionDetails | undefined
  >(undefined);
  const [agentState, setAgentState] = useState<AgentState>("disconnected");

  const onConnectButtonClicked = useCallback(async () => {
    // Generate room connection details, including:
    //   - A random Room name
    //   - A random Participant name
    //   - An Access Token to permit the participant to join the room
    //   - The URL of the LiveKit server to connect to
    //
    // In real-world application, you would likely allow the user to specify their
    // own participant name, and possibly to choose from existing rooms to join.

    const url = new URL(
      process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ??
      "/api/connection-details",
      window.location.origin
    );
    const response = await fetch(url.toString());
    const connectionDetailsData = await response.json();
    updateConnectionDetails(connectionDetailsData);
  }, []);

  return (
    <main
      data-lk-theme="default"
      className="h-full w-full bg-[var(--lk-bg)] p-4"
    >
      <h1 className="text-xl">AI Cofounder Call</h1>

      <LiveKitRoom
        token={connectionDetails?.participantToken}
        serverUrl={connectionDetails?.serverUrl}
        connect={connectionDetails !== undefined}
        audio={true}
        video={false}
        onMediaDeviceFailure={onDeviceFailure}
        onDisconnected={() => {
          updateConnectionDetails(undefined);
        }}
        className="grid grid-rows-[2fr_1fr] h-3/4 items-center pt-4"
      >
        <div className="flex flex-row gap-4 bg-gray-600 mx-4">
          <TaskDisplay />
        </div>
        <SimpleVoiceAssistant onStateChange={setAgentState} />
        <ControlBar
          onConnectButtonClicked={onConnectButtonClicked}
          agentState={agentState}
        />
        <RoomAudioRenderer />
        <NoAgentNotification state={agentState} />
      </LiveKitRoom>
    </main>
  );
}

function SimpleVoiceAssistant(props: {
  onStateChange: (state: AgentState) => void;
}) {
  const { state, audioTrack } = useVoiceAssistant();
  useEffect(() => {
    props.onStateChange(state);
  }, [props, state]);
  return (
    <div className="h-[200px] max-w-[15vw] mx-auto">
      <BarVisualizer
        state={state}
        barCount={5}
        trackRef={audioTrack}
        className="agent-visualizer"
        options={{ minHeight: 24 }}
      />
    </div>
  );
}

function ControlBar(props: {
  onConnectButtonClicked: () => void;
  agentState: AgentState;
}) {
  /**
   * Use Krisp background noise reduction when available.
   * Note: This is only available on Scale plan, see {@link https://livekit.io/pricing | LiveKit Pricing} for more details.
   */
  const krisp = useKrispNoiseFilter();
  useEffect(() => {
    krisp.setNoiseFilterEnabled(true);
  }, []);

  return (
    <div className="relative h-[100px]">
      <AnimatePresence>
        {props.agentState === "disconnected" && (
          <motion.button
            initial={{ opacity: 0, top: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, top: "-10px" }}
            transition={{ duration: 1, ease: [0.09, 1.04, 0.245, 1.055] }}
            className="uppercase absolute left-1/2 -translate-x-1/2 px-4 py-2 bg-white text-black rounded-md"
            onClick={() => props.onConnectButtonClicked()}
          >
            Start a conversation
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {props.agentState !== "disconnected" &&
          props.agentState !== "connecting" && (
            <motion.div
              initial={{ opacity: 0, top: "10px" }}
              animate={{ opacity: 1, top: 0 }}
              exit={{ opacity: 0, top: "-10px" }}
              transition={{ duration: 0.4, ease: [0.09, 1.04, 0.245, 1.055] }}
              className="flex h-8 absolute left-1/2 -translate-x-1/2  justify-center"
            >
              <VoiceAssistantControlBar controls={{ leave: false }} />
              <DisconnectButton>
                <CloseIcon />
              </DisconnectButton>
            </motion.div>
          )}
      </AnimatePresence>
    </div>
  );
}

function onDeviceFailure(error?: MediaDeviceFailure) {
  console.error(error);
  alert(
    "Error acquiring camera or microphone permissions. Please make sure you grant the necessary permissions in your browser and reload the tab"
  );
}
