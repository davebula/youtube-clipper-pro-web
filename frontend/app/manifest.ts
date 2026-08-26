import type { MetadataRoute } from "next";
export default function manifest():MetadataRoute.Manifest{return{name:"YouTube Clipper Pro Web",short_name:"Clipper Pro",description:"Create precise MP4 video clips.",start_url:"/",display:"standalone",background_color:"#090b10",theme_color:"#ff493f",icons:[{src:"/favicon.svg",sizes:"any",type:"image/svg+xml",purpose:"any"}]};}
