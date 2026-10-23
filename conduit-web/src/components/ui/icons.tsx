import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowLeftRightIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BellIcon,
  BoxesIcon,
  BrainIcon,
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeXmlIcon,
  Columns2Icon,
  CopyIcon,
  CpuIcon,
  DeleteIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FileCode2Icon,
  FileDiffIcon,
  FileIcon,
  FilePenLineIcon,
  FileTextIcon,
  FocusIcon,
  FolderIcon,
  FolderInputIcon,
  FolderPlusIcon,
  GaugeIcon,
  GitBranchIcon,
  GitCompareArrowsIcon,
  GlobeIcon,
  HomeIcon,
  ImageIcon,
  KeyboardIcon,
  LayersIcon,
  LayoutDashboardIcon,
  LightbulbIcon,
  LogOutIcon,
  Maximize2Icon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  MessageSquareTextIcon,
  MicIcon,
  Minimize2Icon,
  MonitorIcon,
  PaletteIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  PanelLeftOpenIcon,
  PanelRightIcon,
  PaperclipIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
  PlusIcon,
  QrCodeIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  ShareIcon,
  ShieldCheckIcon,
  ShrinkIcon,
  SquareIcon,
  SmartphoneIcon,
  SquareTerminalIcon,
  TerminalIcon,
  TextCursorInputIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
  UploadIcon,
  WrapTextIcon,
  WrenchIcon,
  XIcon
} from "lucide-solid";

/* The shared icon vocabulary: one glyph per concept, imported as Icons (Icons.Settings). Every icon two or more files use is
   here; one a single file uses may stay its own import. Named exports, so a bundle takes only the glyphs it uses. */
/** Runtime activity and status. */
export const Runtime = ActivityIcon;
/** Add an item or open creation options. */
export const Add = PlusIcon;
/** Download, move downward or reach recent content. */
export const ArrowDown = ArrowDownIcon;
/** Return to the previous view. */
export const Back = ArrowLeftIcon;
/** Swap pane or comparison sides. */
export const Swap = ArrowLeftRightIcon;
/** Confirm a location or sign in. */
export const Proceed = ArrowRightIcon;
/** Move upward or publish changes. */
export const ArrowUp = ArrowUpIcon;
/** Delete text before the cursor. */
export const Backspace = DeleteIcon;
/** An agent notification. */
export const Notification = BellIcon;
/** A collection or grouped identity. */
export const Boxes = BoxesIcon;
/** Capture a photo attachment. */
export const Camera = CameraIcon;
/** A chat or its messages. */
export const Chat = MessageSquareIcon;
/** A selected, successful or completed state. */
export const Check = CheckIcon;
/** Expand a choice or move to the next match. */
export const ChevronDown = ChevronDownIcon;
/** Return to the previous item. */
export const ChevronLeft = ChevronLeftIcon;
/** Open a child item or move forward. */
export const ChevronRight = ChevronRightIcon;
/** Close or dismiss the current surface. */
export const Close = XIcon;
/** Run a script or show code. */
export const Code = CodeXmlIcon;
/** Compact the chat context. */
export const Compact = ShrinkIcon;
/** Copy content to the clipboard. */
export const Copy = CopyIcon;
/** A model hosted on this machine. */
export const LocalModel = CpuIcon;
/** The application dashboard. */
export const Dashboard = LayoutDashboardIcon;
/** Delete the selected item. */
export const Delete = Trash2Icon;
/** Download a file or update. */
export const Download = DownloadIcon;
/** Edit or rename the selected item. */
export const Edit = PencilIcon;
/** Open a destination outside the current view. */
export const ExternalLink = ExternalLinkIcon;
/** A file with no more specific type. */
export const File = FileIcon;
/** A source file, file path or source view. */
export const FileCode = FileCode2Icon;
/** File changes or an unstaged diff. */
export const FileDiff = FileDiffIcon;
/** A text file, prompt or document view. */
export const FileText = FileTextIcon;
/** Give keyboard focus to the terminal. */
export const Focus = FocusIcon;
/** A folder or workspace location. */
export const Folder = FolderIcon;
/** The model service level. */
export const ServiceLevel = GaugeIcon;
/** A source-control branch. */
export const GitBranch = GitBranchIcon;
/** Review source-control changes. */
export const GitCompareArrows = GitCompareArrowsIcon;
/** Fetch content from the web. */
export const Fetch = GlobeIcon;
/** Hide content from view. */
export const Hide = EyeOffIcon;
/** The home directory or home view. */
export const Home = HomeIcon;
/** An image file or attachment. */
export const Image = ImageIcon;
/** Insert or edit text at the cursor. */
export const InsertText = TextCursorInputIcon;
/** Keyboard input and shortcuts. */
export const Keyboard = KeyboardIcon;
/** Sign out of the server. */
export const LogOut = LogOutIcon;
/** Expand a pane or attachment. */
export const Maximize = Maximize2Icon;
/** A message or agent narration. */
export const Message = MessageSquareTextIcon;
/** Microphone. */
export const Microphone = MicIcon;
/** Restore a pane to its smaller size. */
export const Minimize = Minimize2Icon;
/** This computer or display appearance. */
export const Monitor = MonitorIcon;
/** Additional actions for this item. */
export const More = EllipsisIcon;
/** Move a chat into a folder. */
export const MoveToFolder = FolderInputIcon;
/** Start a new chat. */
export const NewChat = MessageSquarePlusIcon;
/** Create a folder. */
export const NewFolder = FolderPlusIcon;
/** Edit the workspace identity. */
export const WorkspaceIdentity = PaletteIcon;
/** Collapse the file navigation. */
export const CollapseFiles = PanelLeftCloseIcon;
/** Expand the file navigation. */
export const ExpandFiles = PanelLeftOpenIcon;
/** Attach files to a message. */
export const Attach = PaperclipIcon;
/** Agent permissions and approval policy. */
export const Permissions = ShieldCheckIcon;
/** Keep an item in place. */
export const Pin = PinIcon;
/** Release a pinned item. */
export const PinOff = PinOffIcon;
/** Continue or start an operation. */
export const Play = PlayIcon;
/** View content or show a preview. */
export const Preview = EyeIcon;
/** A harness profile or grouped profiles. */
export const Profile = LayersIcon;
/** Scan or show a pairing code. */
export const QrCode = QrCodeIcon;
/** Reasoning controls or thinking content. */
export const Reasoning = BrainIcon;
/** Refresh, retry, reload or regenerate. */
export const Refresh = RefreshCwIcon;
/** Reset a value or restart an action. */
export const Reset = RotateCcwIcon;
/** Find content, commands or items. */
export const Search = SearchIcon;
/** Send a message. */
export const Send = ArrowUpIcon;
/** A connected server. */
export const Server = ServerIcon;
/** Application, workspace and terminal settings. */
export const Settings = SettingsIcon;
/** Share a chat or its link. */
export const Share = ShareIcon;
/** A shell command or terminal tool. */
export const Shell = SquareTerminalIcon;
export const Phone = SmartphoneIcon;
export const Browser = GlobeIcon;
/** Show or hide the left sidebar. */
export const Sidebar = PanelLeftIcon;
/** Show two panes or comparison columns. */
export const Split = Columns2Icon;
/** Stop the current operation. */
export const Stop = SquareIcon;
/** A terminal, command or command palette. */
export const Terminal = TerminalIcon;
/** Agent thinking or reasoning. */
export const Thinking = LightbulbIcon;
/** Undo an edit or discard changes. */
export const Undo = Undo2Icon;
/** Upload a file. */
export const Upload = UploadIcon;
/** A warning or failed operation. */
export const Warning = TriangleAlertIcon;
/** Show or hide the workspace panel. */
export const Workspace = PanelRightIcon;
/** Toggle line wrapping. */
export const WrapText = WrapTextIcon;
/** A tool without a more specific kind. */
export const Tool = WrenchIcon;
/** A file-writing tool. */
export const WriteFile = FilePenLineIcon;
