#!/usr/bin/env python3
"""Dune Stinger v2 — procedural creature, metres, no external assets. Built on the first build (astra-v1), reworked by Claude:
stouter arching legs with spikes, a crested armoured body with glowing flank dashes, a bigger head with a row of glowing eyes, a long lit stinger.
Triangle ceilings are in BUDGET (close-up level up to about 50,000).

Usage: python3 build_dune_stinger.py --out-dir output [--lod 0|1|2]
Dependencies: bpy (tested 4.5.3 / Python 3.11), numpy, Pillow, trimesh.
Default builds all GLBs, measured QA, four views, LOD comparison and pose views.
Use --no-render for geometry/QA only. No animation clips are created.
"""
import bpy  # Must precede bmesh.
import bmesh
import argparse, collections, json, math, os, struct, sys
from pathlib import Path
import numpy as np
from mathutils import Vector, Matrix

PI = math.pi
OUT = None
SHELLS = []
BONES = []
SEG_Y = [-.45 + .12*i for i in range(8)]
WIDTHS = [.116,.134,.142,.136,.121,.103,.085,.066]
# The tail is scaled about its base so that, thrown forward in a strike, the sting can reach past the head (the first tail was only
# long enough to reach the middle of the back). Thickness grows a little less than the length.
TAIL_BASE = (0,.50,.155)
TAIL_SCALE = 2.4
TAIL_GIRTH = 1.45
def tp(p):
    b = Vector(TAIL_BASE)
    return tuple(b + (Vector(p) - b) * TAIL_SCALE)
TAIL = [tp(p) for p in [(0,.50,.155),(0,.635,.255),(0,.660,.422),
        (0,.560,.555),(0,.407,.577)]]
STING_TIP = tp((0,.263,.420))
# Triangle ceilings per level (Kane, 4 Oct: the close-up level may go up to about 50,000; build rich, cut down).
BUDGET = [50000, 12000, 3000]
FILE_BUDGET = 2_000_000

def lerp(a,b,t): return a*(1-t)+b*t

def tint(c,f): return tuple(min(1,max(0,v*f)) for v in c)

def mix(a,b,t): return tuple(lerp(x,y,t) for x,y in zip(a,b))

# Linear colours: warm sand shell, rust bronze, pale bone edges, charcoal joints.
SAND=(.40,.215,.075); EDGE=(.70,.46,.20); BONE=(.82,.62,.34)
BRONZE=(.245,.100,.038); RUST=(.30,.085,.030); DARK=(.039,.029,.023)
WHITE=(1,1,1)

class Geo:
    def __init__(self):
        self.v=[]; self.f=[]; self.col=[]; self.w=[]; self.mat=[]; self.parts=[]

    def shell(self, name, vertices, faces, weights, colors, material=0):
        vertices=[tuple(v) for v in vertices]
        tri=[]
        for f in faces:
            for j in range(1,len(f)-1): tri.append((f[0],f[j],f[j+1]))
        vv=np.array(vertices)
        vol=sum(np.dot(vv[a],np.cross(vv[b],vv[c])) for a,b,c in tri)/6
        if vol<0: tri=[tuple(reversed(f)) for f in tri]
        off=len(self.v)
        self.v.extend(vertices); self.f.extend(tuple(i+off for i in f) for f in tri)
        self.w.extend(weights if isinstance(weights,list) else [weights]*len(vertices))
        self.col.extend(colors if isinstance(colors,list) else [colors]*len(vertices))
        self.mat.extend([material]*len(tri))
        self.parts.append({'name':name,'vertices':[off,len(self.v)],'triangles':len(tri)})

    def rings(self,name,rings,weights,colors,material=0):
        n=len(rings[0]); nr=len(rings)
        faces=[tuple(reversed(range(n))),tuple((nr-1)*n+j for j in range(n))]
        for k in range(nr-1):
            for j in range(n):
                a=k*n+j;b=k*n+(j+1)%n
                faces.append((a,b,b+n,a+n))
        self.shell(name,[v for r in rings for v in r],faces,weights,colors,material)

def add_bone(name,p,parent=None): BONES.append((name,tuple(p),parent))

def leg_points(i,side):
    """Hip, knee, toe. The knee rides high so the legs arch like a scorpion's; front legs reach forward, rear legs trail."""
    y=SEG_Y[i]+.060; w=WIDTHS[i]; t=i/7
    rake=lerp(-.105,.115,t)
    reach=lerp(1.0,.9,t)
    return [Vector((side*w*.85,y,.150)),
            Vector((side*lerp(.262,.225,t)*reach,y-.078+rake*.2,lerp(.236,.214,t))),
            Vector((side*lerp(.385,.330,t)*reach,y+rake*.7+.035,.0))]

def setup_bones():
    BONES.clear();add_bone('Root',(0,0,0));add_bone('Head',(0,-.462,.154),'Root')
    for i,y in enumerate(SEG_Y):
        n=f'Seg{i+1:02d}';add_bone(n,(0,y,.148),'Root' if i==0 else f'Seg{i:02d}')
    for i,p in enumerate(TAIL[:-1]):add_bone(f'Tail{i+1}',p,'Seg08' if i==0 else f'Tail{i}')
    add_bone('Stinger',TAIL[-1],'Tail4')
    for i in range(8):
        for side,s in [(1,'L'),(-1,'R')]:
            p=leg_points(i,side);n=f'Leg{i+1:02d}_{s}'
            add_bone(n+'_Upper',p[0],f'Seg{i+1:02d}');add_bone(n+'_Lower',p[1],n+'_Upper')
    for side,s in [(1,'L'),(-1,'R')]:add_bone('Mandible_'+s,(side*.070,-.567,.123),'Head')

def sweep(g,name,points,radii,n,weights,color,material=0,phase=0):
    """Closed authored loft. Elliptical sections follow a path without mesh modifiers."""
    pp=[Vector(p) for p in points];rings=[];cc=[];ww=[]
    ref=Vector((0,1,0)) if abs((pp[1]-pp[0]).normalized().x)>.7 else Vector((1,0,0))
    for k,p in enumerate(pp):
        t=(pp[min(k+1,len(pp)-1)]-pp[max(k-1,0)]).normalized()
        u=(ref-t*ref.dot(t)).normalized();v=t.cross(u).normalized()
        a,b=radii[k] if isinstance(radii[k],tuple) else (radii[k],radii[k])
        rings.append([p+u*a*math.cos(2*PI*j/n+phase)+v*b*math.sin(2*PI*j/n+phase) for j in range(n)])
        wk=weights[k] if isinstance(weights,list) else weights
        ww.extend([wk]*n)
        for j in range(n):
            if callable(color):cc.append(color(k,j,n))
            else:cc.append(color)
    g.rings(name,rings,ww,cc,material)

def blade(g,name,base,tip,width,thick,wt,color,n=4,lift=None,material=0):
    """A closed spike: wide at the base, sharp at the tip, optionally bent by a lifted midpoint."""
    a=Vector(base);b=Vector(tip);m=a.lerp(b,.5)+(Vector(lift) if lift else Vector((0,0,0)))
    sweep(g,name,[a,m,b],[(width,thick),(width*.55,thick*.55),(width*.04,thick*.04)],n,wt,color)

def plate_colour(i,k,x,z,last):
    """Rust-banded plate: pale bone on the leading edge and crest, sand on top, rust on the skirts, charcoal underneath."""
    f=lerp(1.08,.74,i/7)
    if k==0:c=BONE
    elif z<-.5:c=DARK
    elif z>.45:c=mix(SAND,RUST,.35+.5*(i/7)) if abs(x)<.6 else mix(BRONZE,RUST,.5)
    else:c=BRONZE
    if k==last:c=tint(EDGE,.8) if z>0 else DARK
    if abs(x)<.14 and z>.3:c=mix(c,BONE,.35)  # crest line
    return tint(c,f)

def armor(g,i,lod):
    name=f'Seg{i+1:02d}';w=WIDTHS[i];y=SEG_Y[i];wt={name:1}
    n=[20,10,5][lod]
    # (dy, width scale, height scale): a keeled dorsal plate with a shoulder break and flared skirt.
    full=[(-.018,.70,.72),(-.008,.82,.88),(.004,.93,.98),(.026,1.04,1.04),(.050,1.08,1.04),(.080,1.02,.94),(.111,.95,.80),(.132,.85,.62),(.147,.72,.44)]
    mid=[full[0],full[2],full[4],full[6],full[8]]
    low=[(-.012,1.05,.96),(.14,1.03,.78)]
    profiles=[full,mid,low][lod]
    rings=[];colors=[]
    zc=.155-.015*(i/7)
    last=len(profiles)-1
    for k,(dy,scale,h) in enumerate(profiles):
        ring=[]
        for j in range(n):
            ang=2*PI*j/n+(PI/2 if lod==2 else 0)
            x=math.cos(ang);z=math.sin(ang)
            crest=.022*max(0,1-abs(x)*2.6)**1.6 if z>0 else 0
            zz=zc+(.079*h*z+.012*h*max(0,1-abs(x)*3)+crest*h if z>=0 else .038*z)
            yy=y+dy+.040*(abs(x)**1.7)
            ring.append((x*w*scale,yy,zz))
            colors.append(plate_colour(i,k if lod<2 else -1,x,z,last if lod<2 else -1))
        rings.append(ring)
    g.rings('carapace_'+name,rings,wt,colors)
    if lod==2:return
    top=zc+.079+.022
    # Dorsal crest blade, tallest in the middle of the body, raked backwards.
    hgt=lerp(.022,.040,math.sin(PI*(i+.5)/8))
    blade(g,'crest_'+name,(0,y+.040,top-.014),(0,y+.040+.046,top+hgt),.012,.007,wt,tint(EDGE,.9),5 if lod==0 else 4,lift=(0,.004,.006))
    for s in (-1,1):
        # Flank spur sweeping out and back, and a row of glowing flank dashes.
        blade(g,'spur_'+name,(s*w*.88,y+.080,zc+.020),(s*(w*.88+.062),y+.150,zc-.004),.015,.011,wt,mix(BRONZE,EDGE,.5),5 if lod==0 else 4,lift=(s*.004,.010,.012))
        if lod==0:
            blade(g,'rib_'+name,(s*w*.30,y+.020,top-.008),(s*w*.80,y+.100,zc+.050),.007,.005,wt,mix(BRONZE,BONE,.35),4,lift=(0,0,.012))
        sweep(g,'flank_glow',[(s*w*.93,y+.046,zc+.024),(s*w*.99,y+.090,zc+.016)],[(.0058,.005),(.005,.0042)],[6,4,3][lod],wt,WHITE,1)

def build_geo(lod):
    g=Geo()
    n=[12,8,4][lod];rings=[];ww=[];cc=[]
    for i in range(9):
        y=SEG_Y[0]-.019+i*.12;idx=min(i,7);w=WIDTHS[idx]*.72
        rings.append([(math.cos(2*PI*j/n)*w,y,.141+math.sin(2*PI*j/n)*.038) for j in range(n)])
        wt={f'Seg{idx+1:02d}':1} if i in (0,8) else {f'Seg{i:02d}':.5,f'Seg{i+1:02d}':.5}
        ww.extend([wt]*n);cc.extend([DARK]*n)
    g.rings('continuous_dermis',rings,ww,cc)
    for i in range(8):armor(g,i,lod)
    # Head: broad wedge shield with brow ridges, a pale snout plate and a row of glowing eyes down each cheek.
    hp=[(0,-.430,.160),(0,-.470,.176),(0,-.515,.182),(0,-.560,.168),(0,-.598,.142),(0,-.625,.122)]
    hr=[(.082,.050),(.118,.066),(.134,.072),(.112,.062),(.074,.042),(.034,.022)]
    if lod>0:hp=[hp[0],hp[2],hp[4],hp[5]];hr=[hr[0],hr[2],hr[4],hr[5]]
    if lod==2:hp=[hp[0],hp[2],hp[3]];hr=[hr[0],hr[1],hr[3]]
    sweep(g,'head_shield',hp,hr,[18,10,5][lod],{'Head':1},
          lambda k,j,n: BONE if k>=len(hp)-2 and math.sin(2*PI*j/n)>0 else tint(SAND,.85) if math.sin(2*PI*j/n)>0 else BRONZE)
    for side,s in [(1,'L'),(-1,'R')]:
        b='Mandible_'+s
        if lod<2:
            # Brow ridge over the eyes, and a horn at the front corner of the head.
            blade(g,'brow',(side*.040,-.470,.206),(side*.128,-.548,.190),.016,.010,{'Head':1},EDGE,5,lift=(0,0,.016))
            blade(g,'horn',(side*.100,-.590,.150),(side*.150,-.676,.176),.017,.012,{'Head':1},BONE,5,lift=(side*.008,0,.010))
        pts=[(side*.070,-.567,.123),(side*.118,-.628,.114),(side*.146,-.704,.110),(side*.112,-.776,.118),(side*.040,-.806,.130)]
        rr=[(.030,.032),(.040,.030),(.032,.024),(.018,.014),(.0008,.001)]
        if lod==2:pts=[pts[0],pts[2],pts[4]];rr=[rr[0],rr[2],rr[4]]
        elif lod==1:pts=[pts[0],pts[1],pts[3],pts[4]];rr=[rr[0],rr[1],rr[3],rr[4]]
        sweep(g,'sickle_'+s,pts,rr,[10,6,4][lod],{b:1},lambda k,j,n: tint(EDGE,.8) if j==0 else tint(BRONZE,1.3) if k<2 else DARK)
        if lod<2:
            for q in range(3 if lod==0 else 1):
                y=-.664-.030*q
                blade(g,'mandible_tooth',(side*(.138-.006*q),y,.110),(side*(.082-.002*q),y-.012,.108),.011,.008,{b:1},DARK,4)
            # Inner palp: a small pincer under the sickle.
            sweep(g,'palp_'+s,[(side*.040,-.585,.098),(side*.050,-.655,.092),(side*.026,-.708,.100)],[(.014,.013),(.011,.010),(.0008,.001)],6 if lod==0 else 4,{b:1},tint(BRONZE,1.2))
        # Eyes: a descending row of glowing facets on each cheek, biggest at the back.
        for q in range(5 if lod==0 else 3 if lod==1 else 1):
            y=-.500-.026*q
            r=.0115-.0012*q
            p=(side*(.104-.003*q),y,.208-.0045*q)
            if lod<2:
                sweep(g,'eye_recess',[(p[0],p[1]+.0115,p[2]-.006),(p[0],p[1]-.0115,p[2]-.006)],[(r+.005,r*.8+.003),(r+.003,r*.8+.002)],6,{'Head':1},DARK)
            sweep(g,'cyan_eye',[(p[0],p[1]+.008,p[2]),(p[0],p[1]-.008,p[2])],[(r,r*.8),(r*.7,r*.6)],[8,5,3][lod],{'Head':1},WHITE,1)
    # Sixteen legs: stout thigh, spiked knee, tapering shin ending in a dark claw.
    for i in range(8):
        for side,s in [(1,'L'),(-1,'R')]:
            hip,knee,toe=leg_points(i,side);up=f'Leg{i+1:02d}_{s}_Upper';lo=f'Leg{i+1:02d}_{s}_Lower'
            th=lerp(1.12,.9,i/7)  # thighs thin out towards the tail
            if lod==0:
                pp=[hip,hip.lerp(knee,.18),hip.lerp(knee,.50),hip.lerp(knee,.82),knee,knee.lerp(toe,.18),knee.lerp(toe,.45),knee.lerp(toe,.76),knee.lerp(toe,.92),toe]
                rr=[(.026*th,.020*th),(.036*th,.027*th),(.034*th,.025*th),(.026*th,.020*th),(.019,.019),(.022,.016),(.017,.012),(.010,.008),(.005,.005),(.0015,.002)]
                wt=[{up:1},{up:1},{up:1},{up:1},{up:.5,lo:.5},{lo:1},{lo:1},{lo:1},{lo:1},{lo:1}]
            elif lod==1:
                pp=[hip,hip.lerp(knee,.35),knee,knee.lerp(toe,.40),knee.lerp(toe,.80),toe]
                rr=[(.026,.020),(.034,.025),(.019,.019),(.019,.014),(.008,.007),(.0015,.002)]
                wt=[{up:1},{up:1},{up:.5,lo:.5},{lo:1},{lo:1},{lo:1}]
            else:
                pp=[hip,knee,toe];rr=[(.028,.022),(.020,.020),(.002,.003)]
                wt=[{up:1},{up:.5,lo:.5},{lo:1}]
            nlg=[10,6,3][lod];cnt=len(pp)
            def legcol(k,j,n,cnt=cnt,lod=lod):
                if k>=cnt-(2 if lod<2 else 1):return DARK
                if lod==0 and k in (4,):return EDGE
                if k<=3 if lod==0 else k<=1:return RUST if j<n//2 else tint(BRONZE,.8)
                return tint(SAND,.8) if j==n//4 else BRONZE if j>n//2 else mix(RUST,SAND,.35)
            sweep(g,'leg_'+up,pp,rr,nlg,wt,legcol)
            if lod<2:
                if lod==0:
                    # Ball joint at the knee, so the bend reads as a joint.
                    kz=[-.8,-.45,0,.45,.8]
                    sweep(g,'knee_ball',[knee+Vector((0,0,.024*t)) for t in kz],[(.027*math.sqrt(1-t*t),.027*math.sqrt(1-t*t)) for t in kz],8,{up:.5,lo:.5},EDGE)
                # Knee spike and a second spike on the shin.
                blade(g,'knee_spike',knee+Vector((0,0,.010)),knee+Vector((side*.010,-.012*(1 if i<4 else -1),.040)),.013,.010,{up:.5,lo:.5},EDGE,4)
                if lod==0:
                    q=knee.lerp(toe,.35)
                    blade(g,'shin_spike',q,q+Vector((side*.030,0,.030)),.008,.006,{lo:1},EDGE,4)
    # Flexible tail core under heavily built cuffs.
    corep=[];corer=[];corew=[]
    for i in range(4):
        bn=f'Tail{i+1}'
        corep.extend([TAIL[i],tuple(Vector(TAIL[i]).lerp(Vector(TAIL[i+1]),.5))])
        r=lerp(.040,.021,i/3)*TAIL_GIRTH*(1.25 if lod==2 else 1);corer.extend([r,r*.91])
        corew.extend([{bn:1},{bn:1}])
    corep.append(TAIL[-1]);corer.append(.018*TAIL_GIRTH);corew.append({'Stinger':1})
    corep[0]=tuple(Vector(corep[0])-(Vector(corep[1])-Vector(corep[0])).normalized()*.012)
    sweep(g,'continuous_tail',corep,corer,[8,5,4][lod],corew,DARK if lod<2 else SAND)
    for i in range(4 if lod<2 else 0):
        a=Vector(TAIL[i]);b=Vector(TAIL[i+1]);bn=f'Tail{i+1}'
        nxt=f'Tail{i+2}' if i<3 else 'Stinger'
        r=lerp(.056,.027,i/3)*TAIL_GIRTH
        pp=[a,a.lerp(b,.20),a.lerp(b,.50),a.lerp(b,.82),b] if lod==0 else [a,a.lerp(b,.48),b]
        rr=[(r*.80,r*.74),(r*1.0,r*.92),(r*1.06,r*.94),(r*.82,r*.74),(r*.68,r*.62)] if lod==0 else [(r*.80,r*.74),(r,r*.88),(r*.66,r*.6)]
        pp[-1]=b+(b-a).normalized()*.009
        wt=[{bn:1} for _ in pp];wt[-1]={bn:.65,nxt:.35}
        sweep(g,'tail_cuff_'+bn,pp,rr,[16,8,4][lod],wt,lambda k,j,n: BONE if k==0 else tint(SAND,1.05) if j<n/2 else BRONZE)
        # Two raked spines along the top of each cuff.
        if i<3:
            up_dir=Vector((0,0,1)) if i==0 else Vector((0,-1,0)) if i==1 else Vector((0,-.6,-.8))
            for t in (.25,.65):
                base=a.lerp(b,t);blade(g,'tail_spine',base,base+up_dir*(.045*(1.1-i*.15))+(b-a).normalized()*.018,.009,.006,{bn:1},BONE,4)
    # Venom bulb into a long recurved lancet.
    pp=[TAIL[-1],tp((0,.352,.568)),tp((0,.320,.536)),tp((0,.292,.497)),STING_TIP]
    sweep(g,'venom_lancet',pp,[(r_ * TAIL_GIRTH, s_ * TAIL_GIRTH) for r_, s_ in [(.026,.026),(.040,.029),(.030,.021),(.018,.013),(.001,.001)]],[14,8,4][lod],{'Stinger':1},lambda k,j,n: BRONZE if k<2 else tint(BONE,.7) if k==2 else DARK)
    # The venom itself: a lit seam in the lancet and a glowing bead at its base.
    sweep(g,'venom_glow',[tp(q_) for q_ in [(.022,.350,.553),(.018,.314,.521),(.012,.287,.489),(.002,.268,.438)]],[(.007,.008),(.007,.007),(.005,.005),(.0015,.0015)],[8,5,3][lod],{'Stinger':1},WHITE,1)
    if lod<2:
        sweep(g,'venom_bead',[tp(q_) for q_ in [(0,.392,.585),(0,.372,.592),(0,.352,.585)]],[(.010,.010),(.014,.014),(.010,.010)],[8,5][lod],{'Stinger':1},WHITE,1)
    # Feet: every leg's last ring is lowered so the claw tips sit exactly on y = 0 in the exported file.
    for part in g.parts:
        if part['name'].startswith('leg_'):
            start,end=part['vertices'];n=[10,6,3][lod]
            minz=min(g.v[j][2] for j in range(end-n,end))
            for j in range(end-n,end):
                x,y,z=g.v[j];g.v[j]=(x,y,z-minz)
    return g

def materials():
    st=bpy.data.materials.new('Stinger');st.use_nodes=True;st.use_backface_culling=True
    bs=st.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.46;bs.inputs['Metallic'].default_value=.22
    vc=st.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Col'
    st.node_tree.links.new(vc.outputs['Color'],bs.inputs['Base Color'])
    gl=bpy.data.materials.new('Glow');gl.use_nodes=True;gl.use_backface_culling=True
    bs=gl.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.02,.08,.10,1)
    bs.inputs['Emission Color'].default_value=(.25,.95,1.,1);bs.inputs['Emission Strength'].default_value=1.
    bs.inputs['Roughness'].default_value=.38
    return st,gl

def scene_model(lod):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_bones();g=build_geo(lod)
    arm=bpy.data.armatures.new('DuneStingerSkeleton');rig=bpy.data.objects.new('DuneStingerRig',arm)
    bpy.context.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name,p,parent in BONES:
        b=arm.edit_bones.new(name);b.head=p;b.tail=Vector(p)+Vector((0,0,.04));b.roll=0
        if parent:b.parent=arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT');rig.select_set(False)
    mesh=bpy.data.meshes.new('DuneStingerGeometry');mesh.from_pydata(g.v,[],g.f);mesh.update()
    obj=bpy.data.objects.new('DuneStinger',mesh);bpy.context.collection.objects.link(obj)
    for m in materials():mesh.materials.append(m)
    attr=mesh.color_attributes.new(name='Col',type='BYTE_COLOR',domain='POINT')
    for i,c in enumerate(g.col):attr.data[i].color=(*c,1)
    for i,p in enumerate(mesh.polygons):p.material_index=g.mat[i];p.use_smooth=True
    mesh.set_sharp_from_angle(angle=1.10)
    for name,_,_ in BONES:obj.vertex_groups.new(name=name)
    for i,wt in enumerate(g.w):
        for name,w in wt.items():obj.vertex_groups[name].add([i],w,'REPLACE')
    mod=obj.modifiers.new('Skin','ARMATURE');mod.object=rig;obj.parent=rig
    # The armature modifier is the skin binding, and must remain for glTF export.
    # There are no modelling modifiers or unapplied object transforms.
    bpy.context.view_layer.objects.active=obj;obj.select_set(True);rig.select_set(True)
    return obj,rig,g

def export_glb(path):
    settings=dict(filepath=str(path),export_format='GLB',use_selection=True,
      export_yup=True,export_animations=False,export_skins=True,export_normals=True,
      export_tangents=False,export_texcoords=False,export_materials='EXPORT',
      export_cameras=False,export_lights=False,export_extras=False,export_apply=True,
      export_draco_mesh_compression_enable=False,export_def_bones=True,
      export_armature_object_remove=True,export_leaf_bone=False,
      export_all_vertex_colors=False,export_vertex_color='MATERIAL')
    supported=bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    bpy.ops.export_scene.gltf(**{k:v for k,v in settings.items() if k in supported})
    # Blender 4.5 adds a dummy all-white COLOR_0 to a non-coloured primitive
    # sharing a mesh with a coloured one. Remove that unused attribute to meet
    # the two-material contract exactly. Geometry / skin buffers stay intact.
    doc,blob=read_glb(path)
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            if doc['materials'][prim['material']]['name']=='Glow':
                prim['attributes'].pop('COLOR_0',None)
    jb=json.dumps(doc,separators=(',',':')).encode();jb+=b' '*((-len(jb))%4)
    blob+=b'\0'*((-len(blob))%4)
    Path(path).write_bytes(struct.pack('<4sII',b'glTF',2,28+len(jb)+len(blob))+struct.pack('<II',len(jb),0x4e4f534a)+jb+struct.pack('<II',len(blob),0x004e4942)+blob)

def read_glb(path):
    raw=Path(path).read_bytes();assert raw[:4]==b'glTF'
    jlen,jtype=struct.unpack_from('<II',raw,12);doc=json.loads(raw[20:20+jlen])
    offset=20+jlen;blen,btype=struct.unpack_from('<II',raw,offset)
    return doc,bytearray(raw[offset+8:offset+8+blen])

def accessor(doc,blob,index):
    ac=doc['accessors'][index];bv=doc['bufferViews'][ac['bufferView']]
    typ={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1',5122:'<i2',5120:'i1'}[ac['componentType']]
    n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[ac['type']]
    offset=bv.get('byteOffset',0)+ac.get('byteOffset',0);dt=np.dtype(typ)
    a=np.ndarray((ac['count'],n),dtype=dt,buffer=blob,offset=offset,strides=(bv.get('byteStride',n*dt.itemsize),dt.itemsize)).copy()
    if ac.get('normalized'):a=a/np.iinfo(dt).max
    return a

def node_matrix(n):
    if 'matrix' in n:return np.array(n['matrix']).reshape(4,4).T
    from mathutils import Quaternion
    q=n.get('rotation',[0,0,0,1]);r=np.array(Quaternion((q[3],*q[:3])).to_matrix())
    m=np.eye(4);m[:3,:3]=r@np.diag(n.get('scale',[1,1,1]));m[:3,3]=n.get('translation',[0,0,0]);return m

def world_matrices(doc):
    parent={c:i for i,n in enumerate(doc['nodes']) for c in n.get('children',[])};cache={}
    def world(i):
        if i not in cache:cache[i]=(world(parent[i]) if i in parent else np.eye(4))@node_matrix(doc['nodes'][i])
        return cache[i]
    return [world(i) for i in range(len(doc['nodes']))],parent

def overlap_area(a,b):
    """2D convex triangle intersection area, ignoring shared boundaries."""
    cross=lambda u,v:float(u[0]*v[1]-u[1]*v[0])
    if cross(b[1]-b[0],b[2]-b[0])<0:b=b[::-1]
    poly=list(a)
    for i in range(3):
        aa=b[i];bb=b[(i+1)%3];res=[]
        if not poly:return 0.
        for k,p in enumerate(poly):
            q=poly[(k+1)%len(poly)];dp=cross(bb-aa,p-aa);dq=cross(bb-aa,q-aa)
            if dp>=-1e-10:res.append(p)
            if (dp>0 and dq<0) or (dp<0 and dq>0):res.append(p+(q-p)*dp/(dp-dq))
        poly=res
    return abs(sum(cross(poly[i],poly[(i+1)%len(poly)]) for i in range(len(poly)))/2) if len(poly)>2 else 0.

def audit(path,lod):
    """Independent GLB binary inspection, plus re-open with trimesh."""
    import trimesh
    doc,blob=read_glb(path);world,parent=world_matrices(doc)
    skin=doc['skins'][0];joints=skin['joints'];names=[doc['nodes'][i]['name'] for i in joints]
    allv=[];allf=[];weightmax=0;sumerr=0;invalid=0;normerr=0;primcounts=[]
    for prim in doc['meshes'][0]['primitives']:
        at=prim['attributes'];v=accessor(doc,blob,at['POSITION']);f=accessor(doc,blob,prim['indices']).reshape(-1,3)
        allf.extend(f+len(allv));allv.extend(v);primcounts.append(len(f))
        w=accessor(doc,blob,at['WEIGHTS_0']);ji=accessor(doc,blob,at['JOINTS_0'])
        weightmax=max(weightmax,int((w>1e-7).sum(axis=1).max()));sumerr=max(sumerr,float(abs(w.sum(axis=1)-1).max()))
        invalid+=int(np.sum((w<0)|(~np.isfinite(w))|((w>0)&(ji>=len(joints)))))
        invalid+=int(np.sum(w.sum(axis=1)<1e-7))
        no=accessor(doc,blob,at['NORMAL']);normerr=max(normerr,float(abs(np.linalg.norm(no,axis=1)-1).max()))
    v=np.array(allv);f=np.array(allf,dtype=int)
    # glTF splits material/normal/colour seams. Weld positions to check physical topology.
    _,first,inv=np.unique(np.round(v,7),axis=0,return_index=True,return_inverse=True)
    vv=v[first];ff=inv[f];edges=collections.defaultdict(list)
    for i,t in enumerate(ff):
        for a,b in zip(t,np.roll(t,-1)):edges[tuple(sorted((int(a),int(b))))].append((i,int(a),int(b)))
    boundary=sum(len(e)==1 for e in edges.values());nonman=sum(len(e)!=2 for e in edges.values())
    inconsistent=sum(len(e)==2 and e[0][1:]==e[1][1:] for e in edges.values())
    loose=len(vv)-len(np.unique(ff));area=np.linalg.norm(np.cross(vv[ff[:,1]]-vv[ff[:,0]],vv[ff[:,2]]-vv[ff[:,0]]),axis=1)*.5
    zero=int(np.sum(area<1e-12));dup=len(ff)-len({tuple(sorted(t)) for t in ff})
    adj=[set() for _ in ff]
    for ee in edges.values():
        for x in ee:
            for y in ee:
                if x[0]!=y[0]:adj[x[0]].add(y[0])
    unseen=set(range(len(ff)));volumes=[]
    while unseen:
        stack=[unseen.pop()];component=[]
        while stack:
            i=stack.pop();component.append(i)
            for k in adj[i]:
                if k in unseen:unseen.remove(k);stack.append(k)
        tt=ff[component];volumes.append(float(np.sum(np.einsum('ij,ij->i',vv[tt[:,0]],np.cross(vv[tt[:,1]],vv[tt[:,2]])))/6))
    # Group nearly identical geometric planes and detect positive-area overlap.
    tri=vv[ff];nn=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);nn/=np.linalg.norm(nn,axis=1)[:,None]
    groups=collections.defaultdict(list)
    for i,n in enumerate(nn):
        axis=int(np.argmax(abs(n)));n=n if n[axis]>0 else -n;d=float(n@tri[i,0])
        key=tuple(np.round(np.r_[n,d],5));groups[key].append((i,axis))
    coplanar=0;overlap_details=[]
    for gg in groups.values():
        for k,(a,ax) in enumerate(gg):
            aa=np.delete(tri[a],ax,axis=1)
            for b,_ in gg[k+1:]:
                bb=np.delete(tri[b],ax,axis=1)
                if np.any(aa.max(axis=0)<bb.min(axis=0)-1e-9) or np.any(bb.max(axis=0)<aa.min(axis=0)-1e-9):continue
                if overlap_area(aa,bb)>1e-10:
                    coplanar+=1;overlap_details.append([tri[a].mean(axis=0).tolist(),tri[b].mean(axis=0).tolist()])
    rot_err=max(float(abs(world[i][:3,:3]-np.eye(3)).max()) for i in joints)
    ibm=accessor(doc,blob,skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
    binderr=max(float(abs(world[i]@ibm[k]-np.eye(4)).max()) for k,i in enumerate(joints))
    meshnode=next(n for n in doc['nodes'] if 'mesh' in n)
    imported=trimesh.load(str(path),force='scene',process=False)
    # Bounds and front / left landmarks are measured in exported +Y-up coordinates.
    head=world[next(i for i in joints if doc['nodes'][i]['name']=='Head')][:3,3]
    rear=world[next(i for i in joints if doc['nodes'][i]['name']=='Tail1')][:3,3]
    left=[float(world[i][0,3]) for i in joints if '_L_' in doc['nodes'][i]['name'] or doc['nodes'][i]['name'].endswith('_L')]
    right=[float(world[i][0,3]) for i in joints if '_R_' in doc['nodes'][i]['name'] or doc['nodes'][i]['name'].endswith('_R')]
    result={'lod':lod,'triangles':len(f),'primitive_triangles':primcounts,'file_bytes':path.stat().st_size,
      'bones':len(joints),'bounds_min':v.min(axis=0).tolist(),'bounds_max':v.max(axis=0).tolist(),
      'dimensions_xyz':np.ptp(v,axis=0).tolist(),'trimesh_bounds':imported.bounds.tolist(),
      'closed_shells':len(volumes),'min_signed_volume':min(volumes),'nonpositive_shells':sum(x<=0 for x in volumes),
      'boundary_edges':boundary,'nonmanifold_edges':nonman,'inconsistent_winding_edges':inconsistent,
      'loose_vertices':loose,'zero_area_triangles':zero,'duplicate_triangles':dup,'coplanar_overlapping_pairs':coplanar,
      'max_weights_per_vertex':weightmax,'max_weight_sum_error':sumerr,'invalid_or_unweighted':invalid,
      'max_normal_length_error':normerr,'max_joint_frame_error':rot_err,'max_bind_matrix_error':binderr,
      'head_joint_xyz':head.tolist(),'tail_base_xyz':rear.tolist(),'left_min_x':min(left),'right_max_x':max(right),
      'mesh_transform_identity':bool(np.allclose(node_matrix(meshnode),np.eye(4),atol=1e-6)),
      'materials':doc['materials'],'extensions':doc.get('extensionsUsed',[]),'animation_count':len(doc.get('animations',[])),
      'mesh_count':len(doc['meshes']),'skin_count':len(doc['skins']),'node_count':len(doc['nodes']),
      'primitive_attributes':[list(p['attributes']) for p in doc['meshes'][0]['primitives']],
      'overlap_centroids':overlap_details,
      'skeleton':[{ 'name':doc['nodes'][i]['name'],'parent':doc['nodes'][parent[i]]['name'] if i in parent else None,
                   'world_position':world[i][:3,3].tolist()} for i in joints]}
    failures=[]
    for key in ['boundary_edges','nonmanifold_edges','inconsistent_winding_edges','loose_vertices','zero_area_triangles','duplicate_triangles','coplanar_overlapping_pairs','nonpositive_shells','invalid_or_unweighted']:
        if result[key]:failures.append(key)
    if len(f)>BUDGET[lod]:failures.append('triangle_budget')
    if weightmax>4 or sumerr>1e-5:failures.append('weights')
    if rot_err>1e-6 or binderr>1e-6:failures.append('joint_frames')
    if not (head[2]>0>rear[2] and min(left)>0 and max(right)<0 and abs(v[:,1].min())<1e-6):failures.append('axes')
    if len(joints)>64 or len(doc['meshes'])!=1 or len(doc['skins'])!=1 or len(doc['materials'])!=2:failures.append('structure')
    if path.stat().st_size>FILE_BUDGET:failures.append('file_budget')
    if doc.get('animations') or doc.get('textures') or doc.get('images') or doc.get('extensionsUsed'):failures.append('unwanted_data')
    if 'COLOR_0' not in doc['meshes'][0]['primitives'][0]['attributes'] or 'COLOR_0' in doc['meshes'][0]['primitives'][1]['attributes']:failures.append('colour_contract')
    result['failures']=failures
    return result

def write_report(results):
    same=all(r['skeleton']==results[0]['skeleton'] for r in results)
    (OUT/'measured_checks.json').write_text(json.dumps({'same_skeleton':same,'levels':results},indent=2))
    text=['# Dune Stinger — measured export report','',
      'Original authored procedural geometry: eight shingled keel plates, sixteen swept blade legs, paired sickle mandibles and a raised venom lancet. Warm sand/bronze shell, charcoal flexible tissue, small cyan eye banks and a cyan lancet seam. No downloaded or stock creature meshes.',
      '', '| LOD | Triangles | Bytes | Bones | Closed shells | Dimensions X / Y / Z (m) |',
      '|---|---:|---:|---:|---:|---|']
    for r in results:text.append(f"| {r['lod']} | {r['triangles']:,} | {r['file_bytes']:,} | {r['bones']} | {r['closed_shells']} | "+' / '.join(f'{v:.4f}' for v in r['dimensions_xyz'])+' |')
    text+=['','All numbers above are read from the final GLBs. `measured_checks.json` contains full per-level bounds, materials, skeleton and check results. Geometry is also re-opened with trimesh, independently of Blender.',
      '',f'Identical names, hierarchy and joint positions across supplied levels: **{same}**. Each file contains one mesh, two material primitives and one 49-joint skin. Blender’s armature wrapper is removed on export; the Root joint and skinned mesh are the two scene roots. No other scene objects, animation clips, textures, UVs, tangents or extensions.',
      '', '## Geometry and skin checks', '',
      '| LOD | Open edges | Non-manifold edges | Winding errors | Loose vertices | Zero-area faces | Duplicate faces | Coplanar overlap pairs | Inward shells | Max influences | Weight sum error |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for r in results:
        keys=['boundary_edges','nonmanifold_edges','inconsistent_winding_edges','loose_vertices','zero_area_triangles','duplicate_triangles','coplanar_overlapping_pairs','nonpositive_shells','max_weights_per_vertex']
        text.append('| '+str(r['lod'])+' | '+' | '.join(str(r[k]) for k in keys)+f" | {r['max_weight_sum_error']:.2g} |")
    text+=['','Topology checks weld glTF seam duplicates by position to 1e-7 m. Winding is verified by opposed directed edges and positive signed volume per connected closed shell. Coplanar tests group planes to 1e-5 and test positive triangle-intersection area. Intentional non-coplanar penetration of closed armour and tissue shells is used at articulations; this is not a unioned printable solid. All weights refer to existing joints; every vertex is weighted. No modelling modifiers are used. The Blender armature modifier is retained solely to export the skin.',
      '', '## Axes and materials','',
      '+Y is up, the head and mandibles lie toward +Z, and `_L` joints have positive X. The lowest exported vertices are at Y = 0. The ground origin lies under the central body. Mesh transform is identity. All joint world rest orientations are identity to floating-point precision; local bone rotations are also identity. Joint frames and inverse bind matrices are checked numerically.',
      '', '`Stinger`: vertex layer Col → COLOR_0, metallic 0.22, roughness 0.46. `Glow`: base (0.02, 0.08, 0.10), emission (0.25, 0.95, 1), strength 1.0, metallic 0, roughness 0.38. Both are opaque and single sided (glTF doubleSided omitted, which means false). No emissive-strength extension. Blender 4.5 adds a dummy white colour attribute to Glow; the script removes only that attribute from the exported primitive. No geometry or skin data is changed by this cleanup.',
      '', '## Rig and use','',
      '49 joints: Root, Head, eight Seg bones, four Tail bones, Stinger, 32 leg bones, Mandible_L and Mandible_R. Mandibles are children of Head. Each segment pivot sits at the front of its plate. All edit bones point along Blender +Z, yielding glTF +Y joint frames after export. Rigid plates cover a continuous two-weight dermal sleeve. Legs are continuous meshes with blended knees. Tail cuffs cover a continuous flexible core.',
      '', 'The supplied renders show rest side/front/top/three-quarter, all LODs at the same scale, separate S-curve/tail-curl/stride tests and a combined pose. The tests are temporary poses only; the exported GLBs are neutral and contain no animation.',
      '', 'Run with Python 3.11 and bpy 4.5.3: `python3 build_dune_stinger.py --out-dir <dir> [--lod 0|1|2]`. Install dependencies with `pip install bpy==4.5.3 numpy pillow trimesh`. Use `--no-render` to rebuild and audit only. This script resets its Blender scene, so run it in a dedicated process.',
      '', '## Limits and caveats','',
      'No requested budget was intentionally relaxed. Closed shells can intersect as armour articulates; extreme rotations beyond the illustrated poses can cause collisions. This is an asset-level check, not a Quest performance or game-integration test. Glow strength is deliberately 1.0; a brighter night appearance belongs to the game.']
    for r in results:text.append(f"\nLOD {r['lod']} automated failures: {r['failures'] or 'none'}.")
    (OUT/'dune_stinger_report.md').write_text('\n'.join(text)+'\n')

def render_setup(obj,rig):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=int(os.environ.get('SAMPLES',32))
    scene.cycles.use_denoising=True;scene.render.resolution_x=int(os.environ.get('RES_X',1200));scene.render.resolution_y=int(os.environ.get('RES_X',1200))*3//4;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
    scene.world=bpy.data.worlds.new('StudioWorld');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.10,.13,.17,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.35
    scene.view_settings.view_transform='AgX'
    # Studio helpers are render-only and never exported.
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.008));floor=bpy.context.object;floor.name='RenderOnlyFloor'
    mat=bpy.data.materials.new('RenderOnlyFloor');mat.diffuse_color=(.037,.047,.055,1);mat.use_nodes=True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.037,.047,.055,1)
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.8;floor.data.materials.append(mat)
    for name,loc,power,size,col in [('Key',(1.5,-2.1,3.3),260,3.,(1.,.81,.60)),('Fill',(-2,-.5,1.5),110,2.5,(.48,.73,1.)),('Rim',(.5,2.5,2),230,2.,(1.,.68,.40))]:
        data=bpy.data.lights.new('RenderOnly'+name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=col
        o=bpy.data.objects.new(data.name,data);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,.2))-o.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('RenderOnlyCamera');cam=bpy.data.objects.new(data.name,data);bpy.context.collection.objects.link(cam);scene.camera=cam;data.type='ORTHO';data.ortho_scale=1.75
    return cam

def render_view(cam,path,loc,target=(0,-.01,.26),scale=1.75):
    cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=scale
    bpy.context.scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)

def pose(rig,kind):
    for b in rig.pose.bones:b.rotation_mode='XYZ';b.rotation_euler=(0,0,0)
    if kind in ('s_curve','combined'):
        for i,deg in enumerate([0,16,16,-10,-22,-18,5,14]):
            # Bone +Y is vertical in Blender, hence this becomes exported world +Y yaw.
            rig.pose.bones[f'Seg{i+1:02d}'].rotation_euler.y=math.radians(deg)
    if kind in ('tail_curl','combined'):
        for i,deg in enumerate([10,15,15,10]):rig.pose.bones[f'Tail{i+1}'].rotation_euler.x=math.radians(deg)
        rig.pose.bones['Stinger'].rotation_euler.x=math.radians(-75)
    if kind in ('stride','combined'):
        for i in range(8):
            for s in ['L','R']:
                rig.pose.bones[f'Leg{i+1:02d}_{s}_Upper'].rotation_euler.y=math.radians(-22)
                rig.pose.bones[f'Leg{i+1:02d}_{s}_Lower'].rotation_euler.y=math.radians(8)
    bpy.context.view_layer.update()

def main():
    global OUT
    ap=argparse.ArgumentParser();ap.add_argument('--out-dir',required=True);ap.add_argument('--lod',type=int,choices=[0,1,2]);ap.add_argument('--no-render',action='store_true')
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else None)
    OUT=Path(args.out_dir).resolve();OUT.mkdir(parents=True,exist_ok=True)
    levels=[args.lod] if args.lod is not None else [0,1,2]
    results=[]
    for lod in levels:
        obj,rig,g=scene_model(lod);path=OUT/f'dune_stinger_lod{lod}.glb';export_glb(path)
        print('BUILT',lod,len(g.f),path.stat().st_size,flush=True)
        result=audit(path,lod);results.append(result);print('AUDIT',lod,result['failures'],flush=True)
        (OUT/f'parts_lod{lod}.json').write_text(json.dumps(g.parts,indent=2))
        if not args.no_render:
            cam=render_setup(obj,rig)
            render_view(cam,OUT/f'lod{lod}_three_quarter.png',(1.65,-2.35,1.65),scale=1.8)
            if lod==0:
                render_view(cam,OUT/'lod0_side.png',(2.6,0,.31),scale=1.73)
                render_view(cam,OUT/'lod0_front.png',(0,-2.8,.39),scale=1.10)
                if os.environ.get('QUICK'):continue
                render_view(cam,OUT/'lod0_top.png',(0,0,3),target=(0,-.03,.0),scale=2.1)
                for kind in ['s_curve','tail_curl','stride','combined']:
                    pose(rig,kind);render_view(cam,OUT/f'pose_{kind}.png',(1.6,-2.4,1.9),scale=1.9)
                pose(rig,'rest')
    if not args.no_render and args.lod is None:
        from PIL import Image,ImageDraw,ImageFont
        sheet=Image.new('RGB',(1800,510),(27,32,38));d=ImageDraw.Draw(sheet)
        for lod in levels:
            im=Image.open(OUT/f'lod{lod}_three_quarter.png').convert('RGB').resize((600,450))
            sheet.paste(im,(lod*600,60));d.text((lod*600+25,22),f'LOD {lod}',fill=(227,208,172),font=ImageFont.load_default(size=25))
        sheet.save(OUT/'lod_comparison.png')
    write_report(results)
    print('Build complete.',flush=True)

if __name__=='__main__':main()
