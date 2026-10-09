import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/*
 * Inter (400/500/600/700) self-hosted via next/font — design §2.2 / §8.
 * The `--font-inter` custom property is consumed by `--font-sans` in
 * app/globals.css (design tokens).
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ESCR Library",
    template: "%s · ESCR Library",
  },
  description:
    "East Systems Colleges of Rizal Library Management System — browse, request, and track books.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-scroll-behavior: Next scrolls to top on route change — without
    // this attribute the html { scroll-behavior: smooth } would animate that
    // jump, fighting the page-transition animation (Next dev warning).
    // suppressHydrationWarning: the inline script below adds
    // `escr-cascade` to <html> before React hydrates — the class diff on
    // this ONE element is intentional (next-themes uses the same pattern);
    // React skips attribute comparison for it and nothing else.
    <html
      lang="en"
      className={inter.variable}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body>
        {children}
        {/*
          Cascade arm + beat marker — runs at end of body, still before
          first paint (parser-executed, synchronous), so the cascade
          starts on the very first frame with no flash.

          Arms `escr-cascade` on <html> and syncs the wipe-suppression
          switch (`data-cascade="on"`, kept in sync afterwards by
          PageTransition), then assigns a beat to EVERY content block
          of the visible `.escr-landing-page` — DOM order, containers
          descended up to 3 levels, tables/lists whole, forms included,
          cap 16 beats, 50ms apart.

          Beats are Web Animations (el.animate), NOT DOM attributes:
          React 19 flags pre-hydration attribute injection as a
          hydration mismatch, and the WAAPI writes nothing React can
          diff — safe to run at any time (pre-paint, hydration, RSC
          patch). Animations are kept in `window.__escrCascadePairs`
          and re-used on 'add' passes (mount/streaming), rebuilt from
          scratch on 'restart' (page switch — beats must replay).

          On SPA switches PageTransition re-arms `escr-cascade` when
          the pathname changes, restarts the beats, and disarms after
          the cascade settles (scaled to beat count).
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  var d=document.documentElement,CAP=16,EASE='cubic-bezier(0.4, 0, 0.2, 1)';
  var KF=[{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'none'}];
  var pairs=[];
  var ATOMIC={TABLE:1,UL:1,OL:1,CANVAS:1,IMG:1,PICTURE:1,VIDEO:1,AUDIO:1,IFRAME:1,HR:1,PRE:1,SVG:1};
  window.__escrCascadePairs=pairs;
  function walk(node,depth,seen){
    var kids=node.children;
    for(var i=0;i<kids.length;i++){
      var el=kids[i],t=el.tagName;
      if(t==='SCRIPT'||t==='STYLE'||t==='LINK')continue;
      if(!el.getClientRects().length)continue;
      if(ATOMIC[t]||!el.children.length||n>=CAP){pushBeat(el,seen);continue;}
      var c=el.children.length;
      if(depth<2&&c>=2&&c<=8){walk(el,depth+1,seen);}else{pushBeat(el,seen);}
    }
  }
  var n=0;
  function pushBeat(el,seen){
    n=n>=CAP?CAP:n+1;
    if(seen.has(el))return;
    seen.add(el);
    pairs.push([el,el.animate(KF,{duration:320,delay:(n-1)*50,easing:EASE,fill:'backwards'})]);
  }
  window.__escrMarkCascade=function(mode){
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      pairs.forEach(function(p){p[1].cancel();});
      pairs.length=0;
      return 0;
    }
    n=0;
    var w=document.querySelector('.escr-page-in');
    if(!w)return 0;
    var roots=w.querySelectorAll('.escr-landing-page');
    var vis=[],any=false;
    for(var i=0;i<roots.length;i++){
      if(roots[i].getClientRects().length){vis.push(roots[i]);any=true;}
    }
    if(any)d.setAttribute('data-cascade','on');
    else d.removeAttribute('data-cascade');
    if(mode==='restart'){
      pairs.forEach(function(p){p[1].cancel();});
      pairs.length=0;
    }else{
      for(var j=pairs.length-1;j>=0;j--){
        if(!pairs[j][0].isConnected){pairs[j][1].cancel();pairs.splice(j,1);}
      }
    }
    var seen=new Set(mode==='restart'?[]:pairs.map(function(p){return p[0];}));
    n=0;
    for(var v=0;v<vis.length;v++)walk(vis[v],0,seen);
    return n;
  };
  d.classList.add('escr-cascade');
  window.__escrMarkCascade('restart');
})();
`,
          }}
        />
      </body>
    </html>
  );
}
