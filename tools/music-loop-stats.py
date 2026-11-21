# loop-seam statistics for review/music-loop-check.wav (boundaries at firstBar + k * loopSeconds)
import numpy as np, wave, json, sys
path = sys.argv[1] if len(sys.argv) > 1 else '/workspace/executive-board/review/music-loop-check.wav'
w=wave.open(path); sr=w.getframerate(); n=w.getnframes()
x=np.frombuffer(w.readframes(n),dtype='<i2').reshape(-1,2).astype(np.float64)/32768
bar=240/86; L=16*bar; first=0.1; win=int(0.05*sr)
jump=np.abs(np.diff(x,axis=0)).max(1)
def rms(a,b): s=x[max(0,a):b]; return float(np.sqrt((s**2).mean()))
def stats(t):
    i=int(round(t*sr)); r=[rms(i+k*win,i+(k+1)*win) for k in (-2,-1,0,1)]
    return dict(maxJump=round(float(jump[i-win:i+win].max()),4), rms=[round(q,4) for q in r], ratioAfterBefore=round(r[2]/r[1],2))
bounds=[first+k*L for k in (1,2)]
bars=[first+k*bar for k in range(1,int((n/sr-first)/bar)) if all(abs(first+k*bar-b)>0.01 for b in bounds)]
B=[stats(t) for t in bounds]; O=[stats(t) for t in bars]
oj=np.array([o['maxJump'] for o in O]); orat=np.array([o['ratioAfterBefore'] for o in O]); obef=np.array([o['rms'][1] for o in O])
s0=int((first+0.05)*sr); frames=(n-s0)//win
wr=np.sqrt((x[s0:s0+frames*win]**2).reshape(frames,win,2).mean((1,2)))
med=float(np.median(wr))
res=dict(seconds=round(n/sr,2), loops=round((n/sr-first)/L,2), loopBars=16, loopSeconds=round(L,3), boundaries=[round(b,3) for b in bounds], atBoundaries=B,
 otherBarStarts=dict(count=len(O), maxJump_median=round(float(np.median(oj)),4), maxJump_max=round(float(oj.max()),4),
   rmsBefore_median=round(float(np.median(obef)),4), rmsBefore_min=round(float(obef.min()),4),
   ratio_median=round(float(np.median(orat)),2), ratio_range=[round(float(orat.min()),2), round(float(orat.max()),2)]),
 wholeFile=dict(maxJump=round(float(jump.max()),4), maxJumpAt=round(float(jump.argmax()/sr),3), jump_p99_99=round(float(np.quantile(jump,0.9999)),4),
   peak=round(float(np.abs(x).max()),3), rms50_median=round(med,4), rms50_min=round(float(wr.min()),4),
   windows_more_than_26dB_below_median=int((wr<med*0.05).sum()), windows_total=int(frames)))
print(json.dumps(res,indent=1))
open(path.replace('.wav','.json'),'w').write(json.dumps(res,indent=1))
