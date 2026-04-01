"use client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TemplateFile,
  TemplateFolder,
} from "@/modules/playground/lib/path-to-json";
import {
  AlertCircle,
  Bot,
  FileText,
  FolderOpen,
  Save,
  Settings,
  X,
} from "lucide-react";
import { useParams } from "next/navigation";
import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { usePlayground } from "@/modules/playground/hooks/usePlayground";
import { TemplateFileTree } from "@/modules/playground/components/playground-explorer";
import { useFileExplorer } from "@/modules/playground/hooks/useFileExplorer";



const MainPlaygroundPage = () => {
    const {id}=useParams<{id:string}>()

    const {playgroundData,templateData,isLoading,error,saveTemplateData}=usePlayground(id)
    const {
      activeFileId,
      closeAllFiles,
      openFile,
      openFiles,
      setTemplateData,
      setActiveFileId,
      setPlaygroundId,
      setOpenFiles
    }=useFileExplorer()

    useEffect(()=>{setPlaygroundId(id)},[id,setPlaygroundId])
    
    useEffect(()=>{
      if(templateData && !openFiles.length) {
        setTemplateData(templateData)
      }
    },[templateData,setTemplateData,openFiles.length])
    
    const activeFile=openFiles.find((file)=>file.id==activeFileId)
    const hasUnsavedChanges=openFiles.some((file)=>file.hasUnsavedChanges)
    const handleFileSelect=(file:TemplateFile) {
      openFile(file)
    }

  return (
    <TooltipProvider>
        <>
        <TemplateFileTree
          data={templateData!}
          onFileSelect={handleFileSelect}
          selectedFile={activeFile}
          title="File Explorer"
          onAddFile={()=>{}}
          onAddFolder={()=>{}}
          onDeleteFile={()=>{}}
          onDeleteFolder={()=>{}}
          onRenameFile={()=>{}}
          onRenameFolder={()=>{}}
        />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </header>
          <div className="flex flex-1 items-center gap-2">
              <div className="flex flex-col flex-1">
                <h1 className="text-sm font-medium">
                  {playgroundData?.title || "Code Playground"}
                </h1>
                </div>
                </div>
        </SidebarInset>
        </>
    </TooltipProvider>
  )
}

export default MainPlaygroundPage