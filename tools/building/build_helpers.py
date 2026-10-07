"""Oasis building kit: custom geometry, metric tiling UVs, shared flat materials.
Blender 4.5 LTS. Scripts reset the scene before invoking this helper.
"""
import bpy
import bmesh
import math, json
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parent
MAT={}; PARTS=[]; RECORDS=[]
COLORS={'Oasis_Wood_Dark':((.095,.043,.019),.80),'Oasis_Wood_Light':((.32,.18,.080),.73),'Oasis_Stone':((.28,.22,.17),.94),'Oasis_Cord':((.48,.35,.18),.95),'Oasis_Fibre':((.29,.22,.105),.96),'Oasis_Bone':((.59,.48,.31),.65),'Oasis_Crystal_Glow':((.013,.456,.723),.32)}
W='Oasis_Wood_Dark';L='Oasis_Wood_Light';S='Oasis_Stone';C='Oasis_Cord';F='Oasis_Fibre';B='Oasis_Bone';G='Oasis_Crystal_Glow'

def init():
    global MAT,PARTS,RECORDS
    MAT={};PARTS=[];RECORDS=[]
    bpy.context.scene.unit_settings.system='METRIC'
    for name,(col,rough) in COLORS.items():
        m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,1);p.inputs['Roughness'].default_value=rough;m.diffuse_color=(*col,1)
        if name==G:p.inputs['Emission Color'].default_value=(*col,1);p.inputs['Emission Strength'].default_value=2
        MAT[name]=m

def mesh(name,vs,fs,mat,grain=None):
    me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update()
    bm=bmesh.new();bm.from_mesh(me)
    if name=='rough_stone_course':bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(me);bm.free()
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);me.materials.append(MAT[mat]);PARTS.append(ob)
    # Each planar face uses an orthonormal metre basis: no density scaling.
    # V follows longitudinal timber grain wherever the face permits it.
    uv=me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        normal=p.normal.normalized();g=Vector(grain or (0,0,1));v=g-normal*g.dot(normal)
        if v.length<1e-6:
            g=Vector((0,1,0)) if abs(normal.y)<.9 else Vector((1,0,0));v=g-normal*g.dot(normal)
        v.normalize();u=v.cross(normal).normalized()
        for li in p.loop_indices:
            co=me.vertices[me.loops[li].vertex_index].co;uv.data[li].uv=(co.dot(u),co.dot(v))
    return ob

def box(name,center,size,mat,grain=None):
    c=Vector(center);sx,sy,sz=[x/2 for x in size];vs=[c+Vector((x*sx,y*sy,z*sz)) for x,y,z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    if name=='rough_stone_course':
        for i,v in enumerate(vs):
            for axis in range(3):
                inset=.002+.007*(.5+.5*math.sin((i+1)*2.17+sum(center)*7+axis))
                if axis==2 and v.z<=-1+.0001:continue
                v[axis]+=inset if v[axis]<c[axis] else -inset
    return mesh(name,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat,grain)

def beam(name,a,b,width,depth,mat=W,lod=0):
    a=Vector(a);b=Vector(b);t=(b-a).normalized();ref=Vector((0,1,0)) if abs(t.y)<.9 else Vector((0,0,1));u=t.cross(ref).normalized();v=t.cross(u).normalized()
    w=width/2;d=depth/2;e=min(w,d)*.17
    cross=[(-w,-d),(w,-d),(w,d),(-w,d)] if lod else [(-w+e,-d),(w-e,-d),(w,-d+e),(w,d-e),(w-e,d),(-w+e,d),(-w,d-e),(-w,-d+e)]
    n=len(cross);verts=[p+u*x+v*y for p in [a,b] for x,y in cross];faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,verts,faces,mat,t)

def cord_box(name,center,size,axis='z',lod=0):
    # Four broad rectangular cord segments form a low-poly wrap around timber.
    x,y,z=center;sx,sy,sz=size;t=.018
    if axis=='z':
        box(name,(x,y-sy/2+t/2,z),(sx,t,sz),C,(1,0,0));box(name,(x,y+sy/2-t/2,z),(sx,t,sz),C,(1,0,0))
        if not lod:
            box(name,(x-sx/2+t/2,y,z),(t,sy-2*t,sz),C,(0,1,0));box(name,(x+sx/2-t/2,y,z),(t,sy-2*t,sz),C,(0,1,0))
    else:box(name,center,size,C,(1,0,0))

def glow(x,y,z,width=.065,height=.11):
    # Inset crystal; the outermost facet stays inside the wall/door envelope.
    verts=[(x-width/2,y+.012,z),(x,y+.012,z+height/2),(x+width/2,y+.012,z),(x,y+.012,z-height/2),(x,y,z)]
    mesh('cyan_inlay',verts,[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(3,2,1,0)],G,(0,0,1))

def finish(name,lod=0,collider=False):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in PARTS:ob.select_set(True)
    bpy.context.view_layer.objects.active=PARTS[0];bpy.ops.object.join();ob=PARTS[0];ob.name=name+'_collider' if collider else name+'_mesh';ob.data.name=ob.name
    if not collider:ob.data['uv_names']=['UVMap','UV_AO']
    bpy.context.scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR');bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    if not collider:
        ob.data.uv_layers.new(name='UV_AO');ob.data.uv_layers.active_index=1
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.012);bpy.ops.object.mode_set(mode='OBJECT');ob.data.uv_layers.active_index=0;ob.data.uv_layers[0].active_render=True
    root=bpy.data.objects.new(name+'_root',None);bpy.context.collection.objects.link(root);ob.parent=root
    root['grid_metres']=3.;root['piece']=name;root['lod']=lod;root['collider']=collider
    if not collider:
        root['texture_scale']='UVMap: 1 UV unit per metre; grain along V';root['snap_normal']='glTF local +Y';root['uv_ao']='UV_AO / TEXCOORD_1'
        for label,pos,normal in SNAP.get(name,[]):
            e=bpy.data.objects.new(label,None);bpy.context.collection.objects.link(e);e.parent=root;e.location=pos
            # Export conjugates bases: source local +Z becomes glTF local +Y.
            e.rotation_mode='QUATERNION';e.rotation_quaternion=Vector(normal).to_track_quat('Z','Y');e.empty_display_type='ARROWS';e.empty_display_size=.18
    bpy.ops.object.select_all(action='SELECT');path=OUT/(name+('_collider' if collider else '_lod1' if lod else '')+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_apply=True,export_extras=True,export_normals=True,export_texcoords=True,export_materials='EXPORT',export_image_format='NONE')
    ob.data.calc_loop_triangles();print('BUILT',path.name,'triangles',len(ob.data.loop_triangles),flush=True)

SNAP={}
for n in ['foundation','floor']:
    SNAP[n]=[('snap_n',(0,1.5,0),(0,1,0)),('snap_s',(0,-1.5,0),(0,-1,0)),('snap_e',(1.5,0,0),(1,0,0)),('snap_w',(-1.5,0,0),(-1,0,0)),('snap_top',(0,0,0),(0,0,1))]
for n in ['wall','wall_door','wall_window']:
    SNAP[n]=[('snap_bottom',(0,0,0),(0,0,-1)),('snap_top',(0,0,3),(0,0,1)),('snap_left',(-1.5,0,1.5),(-1,0,0)),('snap_right',(1.5,0,1.5),(1,0,0))]
SNAP['stairs']=[('snap_bottom',(0,0,0),(0,-1,0)),('snap_top',(0,3,3),(0,1,0))]
SNAP['roof']=[('snap_low',(0,0,0),(0,-1,0)),('snap_high',(0,3,0),(0,1,0))]
SNAP['pillar']=[('snap_bottom',(0,0,0),(0,0,-1)),('snap_top',(0,0,3),(0,0,1))]

def panel(x0,x1,z0,z1,lod):
    if x1-x0<.02 or z1-z0<.02:return
    box('woven_panel',((x0+x1)/2,0,(z0+z1)/2),(x1-x0,.065,z1-z0),F,(1,0,0))
    if lod:
        count=max(1,int((x1-x0)*(z1-z0)/2))
        for j in range(count):
            z=z0+(j+.5)*(z1-z0)/count
            for side in [-1,1]:box('broad_weave',((x0+x1)/2,side*.038,z),(x1-x0,.012,.07),C,(1,0,0))
        if x1-x0>1.3:box('panel_batten',((x0+x1)/2,-.054,(z0+z1)/2),(.04,.018,z1-z0),L,(0,0,1))
        return
    # Readable, broad woven bands, slightly raised on both sides; no alpha cards.
    count=max(1,int((z1-z0)/.34))
    for j in range(count):
        z=z0+(j+.5)*(z1-z0)/count
        for side in [-1,1]:box('woven_band',((x0+x1)/2,side*.038,z),(x1-x0,.012,.070),C,(1,0,0))
    for x in [x0+(x1-x0)/3,x0+2*(x1-x0)/3]:
        box('panel_batten',(x,-.054,(z0+z1)/2),(.04,.018,z1-z0),L,(0,0,1))

def wall_frame(lod):
    for x in [-1.41,1.41]:
        cuts=[0,3] if lod else [0,.2075,.2725,2.7275,2.7925,3]
        for j in range(len(cuts)-1):beam('end_post' if j%2==0 else 'post_lashing',(x,0,cuts[j]),(x,0,cuts[j+1]),.18,.20,C if j%2 else W,lod)
    for z in [.08,2.92]:beam('cross_rail',(-1.32,0,z),(1.32,0,z),.16,.18,L,lod)

def build_visual(name,lod):
    if name=='foundation':
        box('footing_core',(0,0,-.59),(2.84,2.84,.82),S)
        rows=3 if not lod else 1;cols=5 if not lod else 3
        for row in range(rows):
            z0=-1+row*.8/rows;z1=-1+(row+1)*.8/rows
            for side in [-1,1]:
                for j in range(cols):
                    x0=-1.5+3*j/cols;x1=-1.5+3*(j+1)/cols
                    box('rough_stone_course',((x0+x1)/2,side*1.46,(z0+z1)/2),(x1-x0-.012,.08,z1-z0-.008 if row else z1-z0),S)
                    y0=-1.42+2.84*j/cols;y1=-1.42+2.84*(j+1)/cols
                    box('rough_stone_course',(side*1.46,(y0+y1)/2,(z0+z1)/2),(.08,y1-y0-.012,z1-z0-.008 if row else z1-z0),S)
        # Exact edge perimeter and flush deck; neighbouring modules share only their boundary.
        deck(lod)
    elif name=='floor':deck(lod,ceiling=True)
    elif name in ['wall','wall_door','wall_window']:
        wall_frame(lod)
        if name=='wall':panel(-1.32,1.32,.16,2.84,lod)
        elif name=='wall_door':
            for x in [-.68,.68]:beam('door_jamb',(x,0,0),(x,0,2.36),.16,.18,W,lod)
            beam('door_lintel',(-.60,0,2.28),(.60,0,2.28),.16,.18,L,lod)
            # Clear the bottom threshold beneath the opening.
            bottom=next(o for o in PARTS if o.name.startswith('cross_rail') and max(v.co.z for v in o.data.vertices)<.2);PARTS.remove(bottom);bpy.data.objects.remove(bottom,do_unlink=True)
            for x0,x1 in [(-1.32,-.76),(.76,1.32)]:
                beam('side_sill',(x0,0,.08),(x1,0,.08),.16,.18,L,lod);panel(x0,x1,.16,2.84,lod)
            panel(-.76,.76,2.36,2.84,lod)
            if lod:
                for x in [-.68,.68]:
                    for z in [.3,2.1]:box('jamb_lashing',(x,-.095,z),(.16,.01,.07),C,(1,0,0))
        else:
            for x in [-.58,.58]:beam('window_jamb',(x,0,.84),(x,0,2.16),.16,.18,W,lod)
            for z in [.92,2.08]:beam('window_crosspiece',(-.5,0,z),(.5,0,z),.16,.18,L,lod)
            for x0,x1 in [(-1.32,-.66),(.66,1.32)]:panel(x0,x1,.16,2.84,lod)
            for z0,z1 in [(.16,.84),(2.16,2.84)]:panel(-.66,.66,z0,z1,lod)
            for x in [-.25,.25]:beam('window_bar',(x,0,1),(x,0,2),.045,.05,B,lod)
            glow(0,-.10,.92,.08,.10)
    elif name=='door':
        box('door_backing',(.6,.02,1.1),(1.2,.06,2.2),F,(0,0,1))
        for i in range(4 if lod else 6):
            width=1.2/(4 if lod else 6);x=(i+.5)*width;beam('door_plank',(x,-.01,0),(x,-.01,2.2),width,.06,L if i%3 else W,lod)
        for z in [.20,1.98]:
            cuts=[.02,1.18] if lod else [.02,.12,.18,1.02,1.08,1.18]
            for j in range(len(cuts)-1):
                x0,x1=cuts[j:j+2];box('door_brace_binding' if j%2 else 'door_brace',((x0+x1)/2,-.043,z),(x1-x0,.014,.12),C if j%2 else W,(1,0,0))
        if not lod:
            beam('diagonal_door_brace',(.15,.048,.36),(1.05,.048,1.82),.09,.004,W,0)
        box('bone_pull',(.99,-.041,1.04),(.09,.018,.15),B,(0,0,1));glow(.60,-.05,1.70,.065,.13)
    elif name=='stairs':
        for i in range(12):
            y=(i+.5)*.25;z=(i+1)*.25
            cuts=[-1.5,1.5] if lod and i not in [0,11] else [-1.5,-1.3975,-1.3225,1.3225,1.3975,1.5]
            for j in range(len(cuts)-1):
                x0,x1=cuts[j:j+2];box('tread_lashing' if j%2 else 'tread',((x0+x1)/2,y,z-.055),(x1-x0,.25,.11),C if j%2 else L,(1,0,0))
            if not lod:box('riser',(0,i*.25+.035,z-.18),(3,.07,.14),F,(1,0,0))
        for x in [-1.33,1.33]:
            vs=[(x-.10,.005,0),(x+.10,.005,0),(x-.10,3,2.75),(x+.10,3,2.75),(x-.10,3,2.89),(x+.10,3,2.89),(x-.10,.005,.14),(x+.10,.005,.14)]
            mesh('stair_stringer',vs,[(0,1,3,2),(6,4,5,7),(0,2,4,6),(1,7,5,3),(2,3,5,4),(0,6,7,1)],W,(0,1,1))
    elif name=='roof':
        slope=0
        box('roof_underlay',(0,1.5,-.067),(3,3,.066),F,(0,1,0))
        # Thatch and binding strips partition the top surface: no coplanar overlays.
        count=3 if lod else 10;bands=[-.95,.95] if lod else [-1.2,0,1.2]
        cuts=[-1.5]
        for x in bands:cuts.extend([x-.0275,x+.0275])
        cuts.append(1.5)
        for j in range(count):
            y=(j+.5)*3/count
            for k in range(len(cuts)-1):
                x0,x1=cuts[k:k+2];box('roof_binding' if k%2 else 'thatch_course',((x0+x1)/2,y,-.017),(x1-x0,3/count,.034),C if k%2 else F,(0,1,0))
        for x in [-1.40,0,1.40]:box('roof_rafter',(x,1.5,-.13),(.20,2.74,.06),W,(0,1,0))
        for y in [.065,2.935]:box('roof_edge_rail',(0,y,-.13),(3,.13,.06),L,(1,0,0))
        # Flat 3m roof panel, without protruding rails.
        for ob in PARTS:
            for v in ob.data.vertices:v.co.z+=v.co.y*slope
        # Recompute metric UVs on the flat faces after shaping.
        for ob in PARTS:metric_reproject(ob,(0,1,slope))
    elif name=='pillar':
        beam('pillar_core',(0,0,0),(0,0,3),.27,.27,W,lod)
        if not lod:
            for x,y in [(-.12,-.12),(.12,-.12),(-.12,.12),(.12,.12)]:beam('split_timber_edge',(x,y,.10),(x,y,2.90),.05,.05,L,0)
        for z in ([.18,.24,1.48,2.76,2.82] if not lod else [.21,2.79]):cord_box('pillar_lashing',(0,0,z),(.30,.30,.045),lod=0)
        if True:
            for z in ([1.5] if lod else [.42,2.58]):box('bone_peg',(0,-.14,z),(.10,.02,.06),B,(1,0,0))

def metric_reproject(ob,grain):
    ob.data.update();uv=ob.data.uv_layers[0]
    for p in ob.data.polygons:
        n=p.normal.normalized();g=Vector(grain);v=g-n*g.dot(n)
        if v.length<1e-6:v=Vector((1,0,0))-n*n.x
        if v.length<1e-6:v=Vector((0,0,1))-n*n.z
        v.normalize();u=v.cross(n).normalized()
        for li in p.loop_indices:
            co=ob.data.vertices[ob.data.loops[li].vertex_index].co;uv.data[li].uv=(co.dot(u),co.dot(v))

def deck(lod,ceiling=False):
    for x in [-1.40,1.40]:
        cuts=[-1.5,1.5] if lod else [-1.5,-1.1825,-1.1175,-.4125,-.3475,.3475,.4125,1.1175,1.1825,1.5]
        for j in range(len(cuts)-1):
            y0,y1=cuts[j:j+2];box('deck_lashing' if j%2 else 'deck_edge',(x,(y0+y1)/2,-.10),(.20,y1-y0,.20),C if j%2 else W,(0,1,0))
    for y in [-1.40,1.40]:box('deck_edge',(0,y,-.10),(2.60,.20,.20),W,(1,0,0))
    box('woven_underdeck',(0,0,-.145),(2.6,2.6,.09),F,(0,1,0))
    count=8 if lod and ceiling else 10
    for i in range(count):
        width=2.6/count;x=-1.3+(i+.5)*width
        beam('deck_plank',(x,-1.30,-.055),(x,1.30,-.055),width,.11,L if i%3 else W,lod)
    if not lod and ceiling:
        for y in [-.85,0,.85]:box('underdeck_batten',(0,y,-.19),(2.6,.085,.02),C,(1,0,0))

def build_collider(name):
    if name=='foundation':box(name+'_collider',(0,0,-.5),(3,3,1),S)
    elif name=='floor':box(name+'_collider',(0,0,-.1),(3,3,.2),S)
    elif name=='wall':box(name+'_collider',(0,0,1.5),(3,.2,3),S)
    elif name=='wall_door':
        for x in [-1.05,1.05]:box('jamb',(x,0,1.5),(.9,.2,3),S)
        box('lintel',(0,0,2.6),(1.2,.2,.8),S)
    elif name=='wall_window':
        for x in [-1,1]:box('side',(x,0,1.5),(1,.2,3),S)
        for z in [.5,2.5]:box('rail',(0,0,z),(1,.2,1),S)
    elif name=='door':box('door',(.6,0,1.1),(1.2,.1,2.2),S)
    elif name=='pillar':box('pillar',(0,0,1.5),(.3,.3,3),S)
    elif name=='roof':
        ob=box('roof',(0,1.5,-.08),(3,3,.16),S)
    elif name=='stairs':
        # One closed stepped prism: the collider matches every tread exactly.
        profile=[(0,0),(3,0),(3,3)]
        for i in reversed(range(12)):
            profile.append((i*.25,(i+1)*.25));profile.append((i*.25,i*.25))
        if profile[-1]==profile[0]:profile.pop()
        n=len(profile);vs=[(x,y,z) for x in [-1.5,1.5] for y,z in profile];fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        mesh('stepped_collider',vs,fs,S)

def build(name):
    for lod in [0,1]:
        bpy.ops.wm.read_factory_settings(use_empty=True);init();build_visual(name,lod)
        if name in ['wall','wall_door','wall_window']:
            # Tiny inset top bevel keeps floor-top joins free of coplanar faces.
            for ob in PARTS:
                touched=False
                for v in ob.data.vertices:
                    if v.co.z>2.9999:v.co.z=3-.004*(v.co.y+.1)/.2;touched=True
                if touched:metric_reproject(ob,(0,0,1) if ob.name.startswith('end_post') else (1,0,0))
        finish(name,lod)
    bpy.ops.wm.read_factory_settings(use_empty=True);init();build_collider(name);finish(name,collider=True)
