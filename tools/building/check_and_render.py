import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
import bmesh
import sys, json, math, struct
from pathlib import Path
from mathutils import Vector
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_helpers import SNAP, COLORS
OUT=Path(__file__).resolve().parent
NAMES=['foundation','floor','wall','wall_door','door','wall_window','stairs','roof','pillar']
EXPECTED={'foundation':((-1.5,-1.5,-1),(1.5,1.5,0)),'floor':((-1.5,-1.5,-.2),(1.5,1.5,0)),'wall':((-1.5,-.1,0),(1.5,.1,3)),'wall_door':((-1.5,-.1,0),(1.5,.1,3)),'wall_window':((-1.5,-.1,0),(1.5,.1,3)),'door':((0,-.05,0),(1.2,.05,2.2)),'stairs':((-1.5,0,0),(1.5,3,3)),'roof':((-1.5,0,-.16),(1.5,3,math.sqrt(3))),'pillar':((-.15,-.15,0),(.15,.15,3))}

def load_json(path):
    b=path.read_bytes();length=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+length])

def check(name,suffix):
    bpy.ops.wm.read_factory_settings(use_empty=True);path=OUT/(name+suffix+'.glb');j=load_json(path);bpy.ops.import_scene.gltf(filepath=str(path));scene=bpy.context.scene
    meshes=[o for o in scene.objects if o.type=='MESH'];nodes={o.name:o for o in scene.objects};collider=suffix=='_collider';tris=0;coords=[]
    for ob in meshes:
        ob.data.calc_loop_triangles();tris+=len(ob.data.loop_triangles);coords.extend(ob.matrix_world@v.co for v in ob.data.vertices)
        assert ob.location.length<1e-6 and Vector(ob.rotation_euler).length<1e-6 and max(abs(s-1) for s in ob.scale)<1e-6,(path.name,'transforms')
    low=Vector([min(p[i] for p in coords) for i in range(3)]);high=Vector([max(p[i] for p in coords) for i in range(3)])
    assert (low-Vector(EXPECTED[name][0])).length<.001 and (high-Vector(EXPECTED[name][1])).length<.001,(path.name,'bounds',tuple(low),tuple(high))
    assert not j.get('images') and not j.get('textures'),(path.name,'embedded images')
    materials=[m['name'] for m in j.get('materials',[])];assert all(m in COLORS for m in materials)
    if collider:assert name+'_collider' in nodes
    else:
        assert tris<=1500
        for n,pos,normal in SNAP.get(name,[]):
            assert n in nodes,(path.name,'missing marker',n)
            ob=nodes[n];assert (ob.matrix_world.translation-Vector(pos)).length<1e-5
            direction=ob.matrix_world.to_quaternion()@Vector((0,0,1));assert (direction-Vector(normal)).length<1e-5,(path.name,n,'orientation')
        if name not in ['door','wall_window']:assert 'Oasis_Crystal_Glow' not in materials
        # glTF preserves the two UV channels, with their names recorded in extras.
        assert all('TEXCOORD_0'in p['attributes'] and 'TEXCOORD_1'in p['attributes'] for m in j['meshes'] for p in m['primitives'])
        max_metric_error=0
        for ob in meshes:
            me=ob.data;assert len(me.uv_layers)==2
            me.uv_layers[0].name='UVMap';me.uv_layers[1].name='UV_AO'
            uv=me.uv_layers[0];ao=me.uv_layers[1]
            assert all(-1e-6<=c<=1.000001 for v in ao.data for c in v.uv)
            for t in me.loop_triangles:
                for k in range(3):
                    a,b=t.loops[k],t.loops[(k+1)%3];p=me.vertices[me.loops[a].vertex_index].co;q=me.vertices[me.loops[b].vertex_index].co
                    error=abs((p-q).length-(uv.data[a].uv-uv.data[b].uv).length);max_metric_error=max(max_metric_error,error)
            assert max_metric_error<.00002,(path.name,'UV scale',max_metric_error)
        # Positive-area overlap check in the AO atlas, using a 512px coverage raster.
        coverage=np.zeros((512,512),dtype=np.uint8)
        for ob in meshes:
            me=ob.data;uv=me.uv_layers[1]
            for t in me.loop_triangles:
                p=np.array([tuple(uv.data[i].uv) for i in t.loops])*512
                lo=np.maximum(np.floor(p.min(axis=0)).astype(int),0);hi=np.minimum(np.ceil(p.max(axis=0)).astype(int),512)
                if np.any(hi<=lo):continue
                xx,yy=np.meshgrid(np.arange(lo[0],hi[0])+.5,np.arange(lo[1],hi[1])+.5);a,b,c=p
                den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
                if abs(den)<1e-9:continue
                u=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den;v=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den
                mask=(u>1e-5)&(v>1e-5)&(u+v<1-1e-5);coverage[lo[1]:hi[1],lo[0]:hi[0]]+=mask.astype(np.uint8)
        assert coverage.max()<=1,(path.name,'AO overlap')
    # Test window and doorway collision openings with horizontal rays.
    if collider and name in ['wall_door','wall_window']:
        zs=[.2,1.1,2.1] if name=='wall_door' else [1.1,1.5,1.9]
        for z in zs:
            hit=meshes[0].ray_cast(Vector((0,-1,z)),Vector((0,1,0)))[0];assert not hit,(path.name,'blocked opening')
    if collider and name=='stairs':
        for i in range(12):
            hit,p,normal,index=meshes[0].ray_cast(Vector((0,(i+.5)*.25,4)),Vector((0,0,-1)));assert hit and abs(p.z-(i+1)*.25)<1e-6
    result={'file':path.name,'triangles':tris,'bounds_blender_m':[list(low),list(high)],'size_gltf_xyz_m':[round(high.x-low.x,6),round(high.z-low.z,6),round(high.y-low.y,6)],'nodes':sorted(nodes),'materials':materials,'embedded_textures':0,'bytes':path.stat().st_size,'status':'PASS','snap_positions_blender_m':{n:list(nodes[n].location) for n,_,_ in SNAP.get(name,[]) if n in nodes}}
    if not collider:result['metric_uv_max_error_m']=round(max_metric_error,9);result['ao_uv_overlap_check']='PASS (512px positive-area coverage)';result['snap_local_axis']='glTF +Y outward'
    print(json.dumps(result),flush=True)
    return result,meshes,low,high

def studio(center,scale,loc,res=(1024,768)):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True;scene.render.threads_mode='FIXED';scene.render.threads=8
    scene.render.resolution_x=res[0];scene.render.resolution_y=res[1];scene.render.resolution_percentage=100
    world=bpy.data.worlds.new('neutral_world');scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.19,.19,.19,1);world.node_tree.nodes['Background'].inputs[1].default_value=.6
    scene.view_settings.view_transform='AgX'
    def aim(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    center=Vector(center)
    for v,power,s in [((-1,-2,3),1800,5),((2,1,2),950,4),((-2,2,3),1400,4)]:
        d=bpy.data.lights.new('studio_softbox','AREA');d.energy=power*(scale/4)**2;d.shape='DISK';d.size=s*scale/4;o=bpy.data.objects.new('studio_softbox',d);scene.collection.objects.link(o);o.location=center+Vector(v)*scale;aim(o,center)
    d=bpy.data.cameras.new('camera');o=bpy.data.objects.new('camera',d);scene.collection.objects.link(o);scene.camera=o;o.location=center+Vector(loc);aim(o,center);d.type='ORTHO';d.ortho_scale=scale
    return scene

def render_piece(name,low,high):
    scene=studio((low+high)/2,5.6 if name not in ['door','pillar'] else 4.7,(7,-10,7));scene.render.filepath=str(OUT/'previews'/(name+'.png'));bpy.ops.render.render(write_still=True)

def assembly():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    def place(name,pos,angle=0):
        before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(OUT/(name+'.glb')));new=set(bpy.data.objects)-before;r=next(o for o in new if o.parent is None);r.location=pos;r.rotation_mode='XYZ';r.rotation_euler.z=angle;return r
    for x in [-1.5,1.5]:
        for y in [-1.5,1.5]:place('foundation',(x,y,0))
    place('wall_door',(-1.5,-3,0));place('door',(-2.1,-3,0),math.radians(-38));place('wall_window',(1.5,-3,0))
    for x in [-1.5,1.5]:place('wall',(x,3,0))
    for y in [-1.5,1.5]:place('wall',(-3,y,0),math.pi/2)
    place('wall_window',(3,1.5,0),math.pi/2)
    # Open right-front stair bay makes access and the assembled staircase visible.
    place('stairs',(1.5,-3,0))
    for x,y in [(-1.5,-1.5),(-1.5,1.5),(1.5,1.5)]:place('floor',(x,y,3))
    for x in [-3,0,3]:
        for y in [-3,3]:
            place('pillar',(x,y,0));place('pillar',(x,y,3))
    # Two mirrored roof slopes meet exactly at the ridge over the upper terrace.
    for x in [-1.5,1.5]:
        place('roof',(x,-3,6));place('roof',(x,3,6),math.pi)
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-1.002));plane=bpy.context.object;plane.name='studio_ground';m=bpy.data.materials.new('neutral_grey');m.diffuse_color=(.21,.21,.21,1);plane.data.materials.append(m)
    scene=studio((0,0,3.1),14.5,(12,-15,10),(1400,1200));scene.cycles.samples=48;scene.render.filepath=str(OUT/'previews'/'assembly.png');bpy.ops.render.render(write_still=True)

if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    report=[]
    for name in NAMES:
        for suffix in ['', '_lod1','_collider']:
            result,meshes,low,high=check(name,suffix);report.append(result)
            if '--render'in args and suffix=='' and (not any(n in args for n in NAMES) or name in args):render_piece(name,low,high)
    for name in NAMES:
        a=next(x for x in report if x['file']==name+'.glb');b=next(x for x in report if x['file']==name+'_lod1.glb');ratio=b['triangles']/a['triangles'];assert .23<=ratio<=.37,(name,'LOD ratio',ratio);b['lod_fraction']=round(ratio,3)
    # Exact grid joins, tested against measured re-imported bounds and socket positions.
    f=next(x for x in report if x['file']=='foundation.glb');wall=next(x for x in report if x['file']=='wall.glb')
    assert abs(f['bounds_blender_m'][1][0]-(f['bounds_blender_m'][0][0]+3))<1e-6
    assert abs(f['bounds_blender_m'][1][2]-wall['bounds_blender_m'][0][2])<1e-6
    get=lambda name:next(x for x in report if x['file']==name+'.glb')
    snap=lambda name,label:Vector(get(name)['snap_positions_blender_m'][label])
    foundation_gap=(snap('foundation','snap_e')-(snap('foundation','snap_w')+Vector((3,0,0)))).length
    wall_translation=snap('foundation','snap_n')-snap('wall','snap_bottom')
    wall_gap=abs(wall['bounds_blender_m'][0][2]+wall_translation.z-f['bounds_blender_m'][1][2])
    stairs_gap=(snap('stairs','snap_top')-(snap('floor','snap_s')+Vector((0,4.5,3)))).length
    ridge=snap('roof','snap_high');opposite=Vector((-ridge.x,6-ridge.y,ridge.z));ridge_gap=(ridge-opposite).length
    joins={'adjacent_foundations_gap_or_overlap_m':foundation_gap,'wall_bottom_to_foundation_top_m':wall_gap,'stairs_top_to_floor_top_m':stairs_gap,'roof_ridge_gap_m':ridge_gap,'status':'PASS'}
    assert max(foundation_gap,wall_gap,stairs_gap,ridge_gap)<1e-6
    (OUT/'verification.json').write_text(json.dumps({'files':report,'joins':joins},indent=2)+'\n')
    if '--render'in args:assembly()
    print('ALL 27 GLBS VERIFIED',flush=True)
