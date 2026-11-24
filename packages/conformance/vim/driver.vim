" Reference runner: replays one case in real Vim and records the state after every key.
"
" Started by src/vim-ref.ts as
"   vim --not-a-term -Nu NONE -i NONE -n -S driver.vim
" with $VC_CASE (input JSON) and $VC_OUT (output JSON). Keys are fed one at a time from a
" timer, so each key is handled exactly like a key typed by a person: a timer fires only
" while Vim waits for input, in any mode (also with an operator or a register pending).

set nocompatible
set encoding=utf-8
scriptencoding utf-8

" --- Editor profile (must match packages/engine/src/profile.ts) --------------------------
set shiftwidth=2 tabstop=4 softtabstop=0 expandtab
set noautoindent nosmartindent nocindent indentexpr=
set nogdefault noignorecase nosmartcase wrapscan noincsearch nohlsearch
set nrformats=
set startofline nojoinspaces
set selection=inclusive virtualedit= whichwrap=b,s backspace=indent,eol,start
set iskeyword=@,48-57,_,192-255
set fileformat=unix
" --- Harness hygiene: no files, no prompts that would swallow the next key ----------------
set noswapfile nobackup nowritebackup viminfo= undolevels=1000
set report=99999 shortmess=aoOstTWIcCF nomore cmdheight=10 belloff=all
set notimeout ttimeout ttimeoutlen=0

let s:case = json_decode(join(readfile($VC_CASE), "\n"))

function! s:Key(k) abort
  if a:k ==# '<Space>'
    return ' '
  elseif a:k ==# '<lt>'
    return '<'
  elseif a:k =~# '^<.\+>$'
    return eval('"\' . a:k . '"')
  endif
  return a:k
endfunction

function! s:Pos(p) abort
  return [a:p[1], a:p[2]]
endfunction

function! s:Mode() abort
  let m = mode(1)
  if m =~# '^n'
    return 'normal'
  elseif m =~# '^i'
    return 'insert'
  elseif m =~# '^R'
    return 'replace'
  elseif m ==# 'v'
    return 'visual'
  elseif m ==# 'V'
    return 'visual-line'
  elseif m ==# "\<C-v>"
    return 'visual-block'
  elseif m =~# '^c'
    return 'cmdline'
  endif
  return 'other:' . m
endfunction

function! s:Snap() abort
  let mode = s:Mode()
  let snap = {'mode': mode, 'lines': getline(1, '$'), 'cursor': s:Pos(getcharpos('.'))}
  if mode =~# '^visual'
    let snap.visual = {'anchor': s:Pos(getcharpos('v')), 'head': s:Pos(getcharpos('.'))}
  endif
  let regs = {}
  for r in split('"abcdefghijklmnopqrstuvwxyz', '\zs')
    let type = getregtype(r)
    if type !=# ''
      let regs[r] = {'type': type ==# 'v' ? 'char' : type ==# 'V' ? 'line' : 'block', 'text': getreg(r)}
    endif
  endfor
  let snap.registers = regs
  let marks = {}
  for c in split('abcdefghijklmnopqrstuvwxyz', '\zs')
    let p = getcharpos("'" . c)
    if p[1] > 0
      let marks[c] = s:Pos(p)
    endif
  endfor
  let snap.marks = marks
  return snap
endfunction

call setline(1, s:case.initial.lines)
call setcursorcharpos(s:case.initial.cursor[0], s:case.initial.cursor[1])
let s:keys = map(copy(s:case.tokens), {_, k -> s:Key(k)})
let s:i = 0
let s:snaps = []

function! s:Tick(timer) abort
  call add(s:snaps, s:Snap())
  if s:i < len(s:keys)
    call feedkeys(s:keys[s:i], 't')
    let s:i += 1
    return
  endif
  call timer_stop(a:timer)
  call writefile([json_encode({'version': v:version, 'patch': s:Patch(), 'snapshots': s:snaps})], $VC_OUT)
  qall!
endfunction

function! s:Patch() abort
  let p = 0
  while has('patch-' . (v:version / 100) . '.' . (v:version % 100) . '.' . (p + 1))
    let p += 1
  endwhile
  return p
endfunction

call timer_start(1, function('s:Tick'), {'repeat': -1})
