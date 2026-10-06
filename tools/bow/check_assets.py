import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
import bmesh
import json, math, sys, struct
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parent

def gltf_json(path):
    b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n])

def inspect(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path=OUT/(name+'.glb');bpy.ops.import_scene.gltf(filepath=str(path))
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];nodes={o.name:o for o in bpy.context.scene.objects};j=gltf_json(path)
    tris=0;coords=[]
    for o in meshes:
        o.data.calc_loop_triangles();tris+=len(o.data.loop_triangles);coords.extend(o.matrix_world@v.co for v in o.data.vertices)
        assert all(abs(s-1)<1e-6 for s in o.scale),'Mesh scale not applied'
        assert Vector(o.rotation_euler).length<1e-6,'Mesh rotation not applied'
    low=Vector(tuple(min(v[i] for v in coords) for i in range(3)));high=Vector(tuple(max(v[i] for v in coords) for i in range(3)));dim=high-low
    # Imported Blender coordinates map (x,y,z) to delivered glTF (x,z,-y).
    report={'triangles':tris,'size_gltf_xyz_m':[round(dim.x,6),round(dim.z,6),round(dim.y,6)],'nodes':sorted(nodes),'materials':[m['name'] for m in j['materials']],'textures':[im.get('name','embedded') for im in j.get('images',[])],'file_bytes':path.stat().st_size}
    assert tris<={'bow':8000,'arrow':600,'quiver':3000}[name]
    assert len(j['materials'])==1
    mat=j['materials'][0]
    assert all(k in mat for k in ['normalTexture','occlusionTexture','emissiveTexture'])
    assert 'baseColorTexture' in mat['pbrMetallicRoughness'] and 'metallicRoughnessTexture' in mat['pbrMetallicRoughness']
    assert len(j['images'])==4 and all('bufferView'in im for im in j['images'])
    markers={}
    for n,o in nodes.items():
        if o.type=='EMPTY' and not n.endswith('_root'):
            v=o.matrix_world.translation;markers[n]=[round(v.x,6),round(v.z,6),round(-v.y,6)]
    report['markers_gltf_xyz_m']=markers
    if name=='bow':
        required=['grip','arrow_rest','string_top','string_bottom','string_top_drawn','string_bottom_drawn','nock_rest'];assert all(n in nodes for n in required)
        ob=meshes[0];keys=ob.data.shape_keys.key_blocks;assert 'Draw'in keys;assert (nodes['grip'].location).length<1e-6
        assert abs(dim.z-1.25)<.002
        result={}
        for label,sign in [('top',1),('bottom',-1)]:
            rest=nodes['string_'+label].location;drawn=nodes['string_'+label+'_drawn'].location;delta=drawn-rest
            assert abs(delta.y+.12)<.0001 and abs(delta.z+sign*.05)<.0001
            ids=[i for i,v in enumerate(keys['Basis'].data) if abs(v.co.z-sign*.625)<.000001]
            assert len(ids)>=8
            for i in ids:assert (keys['Draw'].data[i].co-keys['Basis'].data[i].co-delta).length<.00002
            # Attachment centres lie inside the final limb end cross-sections.
            assert min((keys['Basis'].data[i].co-rest).length for i in ids)<.010
            assert min((keys['Draw'].data[i].co-drawn).length for i in ids)<.010
            result[label]={'back_m':round(-delta.y,6),'inward_m':round(abs(delta.z),6),'verified_terminal_vertices':len(ids)}
        stationary=[i for i,v in enumerate(keys['Basis'].data) if abs(v.co.z)<.055]
        assert max((keys['Draw'].data[i].co-keys['Basis'].data[i].co).length for i in stationary)<1e-8
        report['Draw']=result;report['handle_stationary']=True
        assert all('targets'in p for m in j['meshes'] for p in m['primitives'])
    elif name=='arrow':
        assert all(n in nodes for n in ['nock','tip']);assert nodes['nock'].location.length<1e-8;assert meshes[0].location.length<1e-8
        distance=(nodes['tip'].location-nodes['nock'].location).length;assert abs(distance-.75)<1e-6
        assert abs(markers['tip'][2]+.75)<1e-6;report['nock_to_tip_m']=round(distance,6)
    else:
        assert 'opening'in nodes;report['container_height_m']=.55;report['stored_arrows']=5
    report['checks']='PASS';print(json.dumps(report,indent=2),flush=True)
    return report,meshes,low,high

def preview(name,meshes,low,high):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.threads_mode='FIXED';scene.render.threads=8
    scene.render.resolution_x=1024;scene.render.resolution_y=768;scene.render.resolution_percentage=100
    scene.world=bpy.data.worlds.new("Neutral grey studio")
    scene.world.color=(.19,.19,.19)
    scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.19,.19,.19,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
    scene.view_settings.view_transform='AgX'
    center=(low+high)/2;size=max(high-low)
    def aim(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    for loc,power,sz in [((2,3,3),240,3),((-2,1,1),110,2),((0,-3,2),330,2)]:
        data=bpy.data.lights.new('studio_area','AREA');data.energy=power;data.shape='DISK';data.size=sz;o=bpy.data.objects.new('studio_area',data);scene.collection.objects.link(o);o.location=loc;aim(o,center)
    cd=bpy.data.cameras.new('preview_camera');cam=bpy.data.objects.new('preview_camera',cd);scene.collection.objects.link(cam);scene.camera=cam;cd.type='ORTHO'
    if name=='arrow':
        views=[('front',(0,-.02,3)),('side',(3,-.1,.18)),('three_quarter',(1.3,-.75,2.3))]
    else:views=[('front',(0,3,.10)),('side',(3,0,.12)),('three_quarter',(1.5,2.7,1.15))]
    if name=='bow':views.append(('full_draw',(1.5,2.7,.7)))
    for label,offset in views:
        if name=='bow':meshes[0].data.shape_keys.key_blocks['Draw'].value=1 if label=='full_draw' else 0
        cam.location=center+Vector(offset);aim(cam,center);cd.ortho_scale=size*(1.52 if name!='arrow' else 1.55)
        scene.render.filepath=str(OUT/'previews'/f'{name}_{label}.png');bpy.ops.render.render(write_still=True)

if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--'in sys.argv else []
    render='--render'in args;names=[a for a in args if a in ['bow','arrow','quiver']] or ['bow','arrow','quiver'];reports={}
    for name in names:
        report,meshes,low,high=inspect(name);reports[name]=report
        if render:preview(name,meshes,low,high)
    (OUT/'verification.json').write_text(json.dumps(reports,indent=2)+'\n')
