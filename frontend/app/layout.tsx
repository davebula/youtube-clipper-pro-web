import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata:Metadata={title:"YouTube Clipper Pro Web",description:"Create precise MP4 video clips from a mobile-friendly web interface.",manifest:"/manifest.webmanifest",icons:{icon:"/favicon.svg",shortcut:"/favicon.svg"}};
export const viewport:Viewport={themeColor:"#0b0e14",width:"device-width",initialScale:1};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en" data-theme="dark"><body>{children}</body></html>;}
