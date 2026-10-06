import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
import bmesh
import math, os, json, struct
from mathutils import Vector
from pathlib import Path
import numpy as np
OUT = Path(__file__).resolve().parent
(OUT/'textures').mkdir(exist_ok=True)
(OUT/'previews').mkdir(exist_ok=True)
scene=bpy.context.scene
scene.unit_settings.system='METRIC'
scene.render.engine='CYCLES'
scene.cycles.samples=8
scene.cycles.bake_type='EMIT'
scene.render.threads_mode='FIXED'; scene.render.threads=8
parts=[]

def material(name, dark, light, rough, scale, grain=(1,1,1), glow=False):
    m=bpy.data.materials.new(name); m.use_nodes=True
    n=m.node_tree.nodes; l=m.node_tree.links; p=n.get('Principled BSDF')
    tex=n.new('ShaderNodeTexCoord'); v=n.new('ShaderNodeVectorMath'); v.operation='MULTIPLY'; v.inputs[1].default_value=grain; l.new(tex.outputs['Object'],v.inputs[0])
    noise=n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value=scale; noise.inputs['Detail'].default_value=3; noise.inputs['Roughness'].default_value=.72; l.new(v.outputs[0],noise.inputs['Vector'])
    ramp=n.new('ShaderNodeValToRGB'); ramp.name='src_base'; ramp.color_ramp.elements[0].position=.18; ramp.color_ramp.elements[0].color=(*dark,1); ramp.color_ramp.elements[1].position=.82; ramp.color_ramp.elements[1].color=(*light,1); l.new(noise.outputs['Fac'],ramp.inputs[0]); l.new(ramp.outputs[0],p.inputs['Base Color'])
    r=n.new('ShaderNodeMapRange'); r.name='src_rough'; r.inputs['To Min'].default_value=rough-.12; r.inputs['To Max'].default_value=rough+.08; l.new(noise.outputs[0],r.inputs[0]); l.new(r.outputs[0],p.inputs['Roughness'])
    fine=n.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value=scale*9; l.new(v.outputs[0],fine.inputs['Vector'])
    bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.24; bump.inputs['Distance'].default_value=.00045; l.new(fine.outputs[0],bump.inputs['Height']); l.new(bump.outputs[0],p.inputs['Normal'])
    e=n.new('ShaderNodeRGB'); e.name='src_emit'; e.outputs[0].default_value=(*((.013,.456,.723) if glow else (0,0,0)),1)
    l.new(e.outputs[0],p.inputs['Emission Color']); p.inputs['Emission Strength'].default_value=1.8 if glow else 0
    m.diffuse_color=(*light,1); m.use_backface_culling=False
    return m
wood=material('weathered ironwood',(.038,.017,.009),(.21,.095,.031),.70,6,(15,15,.5))
bone=material('worn ivory bone',(.23,.15,.075),(.63,.49,.29),.62,40,(2,2,.2))
chitin=material('slate teal chitin',(.012,.036,.039),(.07,.18,.18),.43,65,(1,1,.25))
cord=material('pale desert fibre',(.24,.16,.075),(.61,.46,.25),.88,150,(1,1,5))
hide=material('weathered hide',(.065,.026,.012),(.25,.11,.04),.87,45,(1,1,1))
violet=material('violet fletching',(.033,.015,.046),(.17,.076,.21),.69,95,(1,4,1))
crystal=material('cyan crystal',(.008,.15,.19),(.04,.52,.62),.30,80,glow=True)

def mesh(name, verts, faces, mat, smooth=False):
    me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update()
    ob=bpy.data.objects.new(name,me); scene.collection.objects.link(ob); ob.data.materials.append(mat)
    bm=bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm,faces=bm.faces); bm.to_mesh(me); bm.free()
    for p in me.polygons:p.use_smooth=smooth
    parts.append(ob); return ob

def sweep(name, centers, widths, depths, mat, sides=8):
    verts=[]; faces=[]
    for c,w,d in zip(centers,widths,depths):
        for k in range(sides):
            a=2*math.pi*k/sides; verts.append((c[0]+w/2*math.cos(a),c[1]+d/2*math.sin(a),c[2]))
    for j in range(len(centers)-1):
        for k in range(sides):
            a=j*sides+k; b=j*sides+(k+1)%sides; faces.append((a,b,b+sides,a+sides))
    faces.extend([tuple(reversed(range(sides))),tuple((len(centers)-1)*sides+k for k in range(sides))])
    return mesh(name,verts,faces,mat,True)

def tube(name, points, radius, mat, sides=5, caps=True):
    verts=[]; faces=[]
    for i,pt in enumerate(points):
        c=Vector(pt); t=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
        t.normalize(); ref=Vector((0,0,1)) if abs(t.z)<.95 else Vector((1,0,0)); u=t.cross(ref).normalized(); v=t.cross(u).normalized()
        for k in range(sides):
            a=2*math.pi*k/sides; verts.append(c+radius*(u*math.cos(a)+v*math.sin(a)))
    for j in range(len(points)-1):
        for k in range(sides):
            a=j*sides+k;b=j*sides+(k+1)%sides;faces.append((a,b,b+sides,a+sides))
    if caps:faces += [tuple(reversed(range(sides))),tuple((len(points)-1)*sides+k for k in range(sides))]
    return mesh(name,verts,faces,mat,True)

def band_z(name,z,xr,yr,y=0,steps=16,r=.0015):
    return tube(name,[(xr*math.cos(2*math.pi*j/steps),y+yr*math.sin(2*math.pi*j/steps),z+.0006*math.sin(j*1.7)) for j in range(steps+1)],r,cord,4,False)

def shard(name,center, size,mat):
    x,y,z=center; w,d,h=size
    vs=[(x-w/2,y,z),(x,y-d/2,z),(x+w/2,y,z),(x,y+d/2,z),(x,y,z+h/2),(x,y,z-h/2)]
    return mesh(name,vs,[(i,(i+1)%4,4) for i in range(4)]+[((i+1)%4,i,5) for i in range(4)],mat)

def join(name,objects=None):
    obs=objects if objects is not None else list(parts)
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:o.select_set(True)
    bpy.context.view_layer.objects.active=obs[0]; bpy.ops.object.join(); ob=obs[0]; ob.name=name
    scene.cursor.location=(0,0,0); bpy.ops.object.origin_set(type='ORIGIN_CURSOR'); bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    return ob

def marker(name,loc,root):
    o=bpy.data.objects.new(name,None);scene.collection.objects.link(o);o.empty_display_type='PLAIN_AXES';o.empty_display_size=.015;o.parent=root;o.location=loc; return o

def root(name):
    o=bpy.data.objects.new(name,None);scene.collection.objects.link(o);return o

def bake_atlas(ob,name):
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.012);bpy.ops.object.mode_set(mode='OBJECT')
    mats=list(set(ob.data.materials)); images={}
    scene.render.bake.margin=8;scene.cycles.samples=4
    for channel in ['BaseColor','Roughness','Emission','Normal','AO']:
        print('BAKE',name,channel,flush=True)
        im=bpy.data.images.new(name+'_'+channel,width=1024,height=1024,alpha=False)
        im.colorspace_settings.name='sRGB' if channel in ['BaseColor','Emission'] else 'Non-Color'
        for m in mats:
            n=m.node_tree.nodes;l=m.node_tree.links
            target=n.new('ShaderNodeTexImage');target.image=im;n.active=target
            for node in n:node.select=False
            target.select=True
            output=n.get('Material Output');p=n.get('Principled BSDF')
            if channel in ['BaseColor','Roughness','Emission']:
                e=n.new('ShaderNodeEmission');e.name='bake_output'
                src=n[{'BaseColor':'src_base','Roughness':'src_rough','Emission':'src_emit'}[channel]]
                l.new(src.outputs[0],e.inputs[0]);l.new(e.outputs[0],output.inputs['Surface'])
            else:l.new(p.outputs[0],output.inputs['Surface'])
        bpy.ops.object.bake(type={'BaseColor':'EMIT','Roughness':'EMIT','Emission':'EMIT','Normal':'NORMAL','AO':'AO'}[channel])
        images[channel]=im
    arr=np.ones((1024*1024,4),dtype=np.float32)
    for channel,idx in [('AO',0),('Roughness',1)]:
        pix=np.empty(1024*1024*4,dtype=np.float32);images[channel].pixels.foreach_get(pix);arr[:,idx]=pix.reshape(-1,4)[:,0]
    arr[:,2]=0
    orm=bpy.data.images.new(name+'_ORM',width=1024,height=1024,alpha=False);orm.colorspace_settings.name='Non-Color';orm.pixels.foreach_set(arr.ravel());images['ORM']=orm
    for c in ['BaseColor','Normal','ORM','Emission']:
        im=images[c];im.filepath_raw=str(OUT/'textures'/f'{name}_{c}.png');im.file_format='PNG';im.save();im.pack()
    mat=bpy.data.materials.new(name+'_PBR_atlas');mat.use_nodes=True;n=mat.node_tree.nodes;l=mat.node_tree.links;p=n.get('Principled BSDF')
    tex={}
    for c in ['BaseColor','Normal','ORM','Emission']:
        t=n.new('ShaderNodeTexImage');t.image=images[c];t.label=c;tex[c]=t
    l.new(tex['BaseColor'].outputs['Color'],p.inputs['Base Color'])
    normal=n.new('ShaderNodeNormalMap');l.new(tex['Normal'].outputs['Color'],normal.inputs['Color']);l.new(normal.outputs[0],p.inputs['Normal'])
    sep=n.new('ShaderNodeSeparateColor');l.new(tex['ORM'].outputs['Color'],sep.inputs[0]);l.new(sep.outputs['Green'],p.inputs['Roughness']);l.new(sep.outputs['Blue'],p.inputs['Metallic'])
    group=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree');group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat');g=n.new('ShaderNodeGroup');g.node_tree=group;l.new(sep.outputs['Red'],g.inputs['Occlusion'])
    l.new(tex['Emission'].outputs['Color'],p.inputs['Emission Color']);p.inputs['Emission Strength'].default_value=1.8
    ob.data.materials.clear();ob.data.materials.append(mat)
    for poly in ob.data.polygons:poly.material_index=0
    return mat

# Blender's standard exporter maps -Y to +Z. Reflect exported Z (including
# winding, normals, morph deltas and sockets) to meet the requested -Z forward.
def correct_forward(path):
    data=Path(path).read_bytes();jl=struct.unpack_from('<I',data,12)[0];j=json.loads(data[20:20+jl]);pos=20+jl;bl=struct.unpack_from('<I',data,pos)[0];binary=bytearray(data[pos+8:pos+8+bl]);done=set()
    def values(i):
        a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];off=v.get('byteOffset',0)+a.get('byteOffset',0);n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];fmt={5126:'f',5125:'I',5123:'H',5121:'B'}[a['componentType']];step=struct.calcsize(fmt)*n;return a,off,n,fmt,v.get('byteStride',step)
    def reflect(i,tangent=False):
        if i in done:return
        done.add(i);a,off,n,fmt,stride=values(i)
        for k in range(a['count']):
            vs=list(struct.unpack_from('<'+fmt*n,binary,off+k*stride));vs[2]*=-1
            if tangent:vs[3]*=-1
            struct.pack_into('<'+fmt*n,binary,off+k*stride,*vs)
        if 'min'in a:a['min'][2],a['max'][2]=-a['max'][2],-a['min'][2]
    for me in j.get('meshes',[]):
        for p in me['primitives']:
            for attr,i in p['attributes'].items():
                if attr in ['POSITION','NORMAL','TANGENT']:reflect(i,attr=='TANGENT')
            for target in p.get('targets',[]):
                for attr,i in target.items():reflect(i)
            a,off,n,fmt,stride=values(p['indices'])
            for k in range(0,a['count'],3):
                loc=[off+(k+t)*stride for t in range(3)];vs=[struct.unpack_from('<'+fmt,binary,q)[0] for q in loc]
                struct.pack_into('<'+fmt,binary,loc[1],vs[2]);struct.pack_into('<'+fmt,binary,loc[2],vs[1])
    for node in j['nodes']:
        if 'translation'in node:node['translation'][2]*=-1
        if 'rotation'in node:node['rotation'][0]*=-1;node['rotation'][1]*=-1
    enc=json.dumps(j,separators=(',',':')).encode();enc+=b' '*((-len(enc))%4);binary+=b'\0'*((-len(binary))%4)
    Path(path).write_bytes(struct.pack('<III',0x46546c67,2,12+8+len(enc)+8+len(binary))+struct.pack('<II',len(enc),0x4e4f534a)+enc+struct.pack('<II',len(binary),0x004e4942)+binary)

def export(ob,r,name):
    ob.parent=r
    bpy.ops.object.select_all(action='DESELECT');r.select_set(True)
    for child in r.children:child.select_set(True)
    path=str(OUT/(name+'.glb'))
    bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_morph=True,export_try_sparse_sk=False,export_try_omit_sparse_sk=False,export_extras=True,export_normals=True,export_texcoords=True,export_materials='EXPORT')
    correct_forward(path)
    print('EXPORTED',path,flush=True)

# Shared low-poly arrow recipe, embedded in both standalone build scripts.
def arrow_geometry(prefix='arrow'):
    start=len(parts)
    tube(prefix+'_shaft',[(0,-.017,0),(0,-.65,0)],.004,wood,8)
    # Split, carved bone nock: two prongs leave an actual open groove at origin.
    for x in [-.0028,.0028]:tube(prefix+'_nock_prong',[(x,0,0),(x,-.023,0)],.0018,bone,5)
    # Faceted knapped head, widest at the rear shoulders, ridge on both faces.
    vs=[(0,-.75,0),(-.014,-.691,0),(-.006,-.676,0),(0,-.686,0),(.006,-.676,0),(.014,-.691,0),(0,-.701,.005),(0,-.701,-.005)]
    mesh(prefix+'_crystal_head',vs,[(i,(i+1)%6,6) for i in range(6)]+[((i+1)%6,i,7) for i in range(6)],crystal)
    tube(prefix+'_head_tang',[(0,-.641,0),(0,-.69,0)],.004,bone,6)
    for y in [-.647,-.653,-.659,-.665]:
        tube(prefix+'_head_binding',[(.0047*math.cos(2*math.pi*k/8),y,.0047*math.sin(2*math.pi*k/8)) for k in range(9)],.001,cord,3,False)
    for k in range(3):
        a=k*2*math.pi/3+.2
        # Thin solid vanes with tapered curved profile; no alpha blending.
        coords=[(-.030,.004),(-.051,.020),(-.089,.022),(-.128,.004)]
        vs=[]
        for side in [-1,1]:
            for y,r in coords:vs.append((r*math.cos(a)+side*.00035*math.sin(a),y,r*math.sin(a)-side*.00035*math.cos(a)))
        ob=mesh(prefix+'_vane',vs,[(0,1,2,3),(7,6,5,4)]+[(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)],violet if k==0 else chitin)
    return parts[start:]

# Mouth z=.22, base z=-.33: the wearable container itself is 55cm long.
N=16
verts=[];faces=[]
levels=[(-.33,.041),(-.315,.052),(-.20,.056),(.0,.060),(.19,.060),(.22,.060),(.22,.054),(.18,.053),(-.305,.046)]
for z,r in levels:
    for k in range(N):
        a=2*math.pi*k/N;verts.append((r*math.cos(a),.012+r*.90*math.sin(a),z))
for j in range(len(levels)-1):
    for k in range(N):a=j*N+k;b=j*N+(k+1)%N;faces.append((a,b,b+N,a+N))
faces += [tuple(reversed(range(N))),tuple((len(levels)-1)*N+k for k in range(N))]
mesh('hollow_hide_body',verts,faces,hide,True)
# Reinforced rolled rims and waist bindings.
for z,rx,ry in [(.212,.060,.054),(.19,.060,.054),(-.308,.053,.048),(-.29,.053,.048),(-.025,.061,.055)]:
    tube('reinforcing_cord',[(rx*math.cos(k*2*math.pi/N),.012+ry*math.sin(k*2*math.pi/N),z) for k in range(N+1)],.0025,cord,4,False)
# Diagonal seam stitches down the front face, each actual solid geometry.
for j in range(12):
    z=-.27+j*.037
    tube('hide_seam_stitch',[(-.008,-.040,z-.004),(.008,-.044,z+.004)],.0015,cord,3)
# An arched back strap with finite thickness, attached at upper/lower collars.
cs=[(0,.065,.15),(.012,.125,.12),(.024,.170,.035),(.030,.175,-.095),(.020,.125,-.235),(0,.054,-.285)]
vs=[]
for x,y,z in cs:vs += [(x-.014,y-.002,z),(x+.014,y-.002,z),(x+.014,y+.002,z),(x-.014,y+.002,z)]
fs=[]
for j in range(len(cs)-1):
    for k in range(4):fs.append((j*4+k,j*4+(k+1)%4,(j+1)*4+(k+1)%4,(j+1)*4+k))
fs += [(3,2,1,0),(20,21,22,23)]
mesh('shoulder_strap',vs,fs,hide,True)
# Bone fasteners and a restrained ornamental cyan shard.
for z in [.135,-.26]:shard('bone_toggle',(0,.071,z),(.033,.01,.018),bone)
shard('mouth_inlay_mount',(0,-.047,.142),(.026,.012,.048),chitin)
shard('mouth_cyan_inlay',(0,-.055,.142),(.011,.006,.031),crystal)
# Five actual complete arrows, heads down inside the container. Small fan.
for i,(x,y,z) in enumerate([(-.026,-.013,.42),(0,-.016,.445),(.026,-.010,.425),(-.017,.018,.43),(.018,.020,.41)]):
    obs=arrow_geometry('stored_arrow_'+str(i+1));tilt=(i-2)*.027
    for o in obs:
        for v in o.data.vertices:
            a,b,c=v.co;v.co=(x+a+b*tilt,y+c,z+.025+b)
# Place the root at the upper back mounting point, between shoulder blades.
for o in parts:
    for v in o.data.vertices:v.co-=Vector((0,.07,.10))
ob=join('quiver_mesh');bake_atlas(ob,'quiver');r=root('quiver_root');r['stored_arrows']=5;r['container_height_m']=.55;r['origin']='Between shoulder blades at strap mounting plane';marker('opening',(0,-.058,.12),r);export(ob,r,'quiver')
